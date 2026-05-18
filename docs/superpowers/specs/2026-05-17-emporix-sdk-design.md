# Emporix Commerce Engine TypeScript SDK — Design

Date: 2026-05-17
Status: Approved (auth/session model corrected against live Emporix docs)

## 1. Goal

Publishable npm packages **`@viu/emporix-sdk`** (core, framework-agnostic) and
**`@viu/emporix-sdk-react`** (React bindings) wrapping the Emporix Commerce
Engine REST API. Hybrid approach: auto-generate low-level types from official
OpenAPI specs, hand-write a facade for DX, auth, tenant injection, and
cross-cutting concerns. pnpm workspace monorepo; core and React layer version
and release independently via Changesets.

- GitHub: `viuteam/emporix-sdk`
- npm scope: `@viu` (public, provenance)
- Node ≥ 18, native `fetch` only, no axios/node-fetch

## 2. Validated Emporix API facts (live docs, 2026-05-17)

These supersede the illustrative assumptions in the original brief.

| Concern | Reality |
|---|---|
| Service token | `POST https://api.emporix.io/oauth/token`, `grant_type=client_credentials`, form-urlencoded `client_id`/`client_secret`, optional space-separated `scope`. Response `{ access_token, token_type, expires_in, scope, ... }`. **No refresh token for service tokens** — re-auth on expiry. |
| Anonymous token | `GET /customerlogin/auth/anonymous/login?tenant={t}&client_id={storefrontClientId}` — GET, **storefront `client_id` only, no secret**. Response `{ access_token, token_type, expires_in (~3599), refresh_token, sessionId, scope }`. Refresh via `GET /customerlogin/auth/anonymous/refresh?tenant&refresh_token&client_id` — preserves the same `sessionId`. |
| Customer login | `POST /customer/{tenant}/login` — **requires the existing anonymous token** so the session (and its cart) survives. Response `{ accessToken, saasToken, refreshToken }`. `saasToken` is required for checkout (checkout itself out of scope now). Logging in without the anonymous token silently creates a NEW session and loses the cart (per official Java SDK guidance). |
| `sessionId` | Carried by the anonymous token; it is the thread that links the anonymous cart to the authenticated customer. The customer token shares the anonymous token's `sessionId`. |
| Cart merge | `POST /cart/{tenant}/carts/{cartId}/merge` — real endpoint, requires a customer token. |
| SSO token exchange | `POST /customer/{tenant}/exchangeauthtoken` (`subjectAccessToken`, `config`) is real. The SDK provides the *seam* (`{ kind: 'raw' }` / injectable `tokenProvider`); implementing the full flow is out of scope. |
| Tenant | Always lowercase (doc-confirmed). The `^[a-z][a-z0-9]+$`, 3–16 char rule is an SDK-side guard, **not** doc-stated — flagged in a code comment. |
| Spec acquisition | Per-service OpenAPI JSON is embedded in the Emporix documentation-portal API-reference pages and retrievable programmatically. YAMLs are vendored and committed; codegen reads committed copies (reproducible CI). |

**Source-of-truth rule:** the vendored OpenAPI YAMLs are authoritative for wire
types. The hand-written facade maps wire shapes to idiomatic names (e.g. wire
`accessToken` → facade `customerToken`), each mapping marked with a code
comment. The brief's TypeScript signatures express target DX, not the wire
contract.

## 3. Architecture

pnpm workspace monorepo. Layout exactly as the original brief
(`packages/sdk`, `packages/react`, `examples/*`, `.changeset`,
`.github/workflows`, root tooling), with `@viu` scope and
`repo: viuteam/emporix-sdk` in `.changeset/config.json`.

```
EmporixClient
 ├─ config (validated: tenant regex, credential sets)
 ├─ logger (root → per-service child loggers, shared LevelResolver)
 ├─ TokenProvider (service/custom + anonymous, caching, locks, refresh)
 ├─ http (fetch wrapper: AuthContext → token, retry, 401 asymmetry, errors, interceptors)
 └─ services: customers | products | categories | carts  (hand-written facades)
```

Each service receives a shared `ClientContext` (config + http + tenant + child
logger + auth). `AuthContext` is **per-call, never stored** — one client
instance safely serves many concurrent shoppers (SSR/edge/multi-tenant).

### 3.1 Config

```ts
new EmporixClient({
  tenant: 'mytenant',
  host: 'https://api.emporix.io',
  credentials: {
    backend:    { clientId, secret, scope? },                // service token
    storefront: { clientId },                                 // anonymous — clientId only
    custom?:    Record<string, { clientId, secret, scope? }>, // named service sets
  },
  tokenProvider?: TokenProvider,        // external injection (SSO/token-exchange)
  timeouts?: { connectMs, readMs },
  retry?:    { maxAttempts },
  cache?:    { expirationBufferSeconds, maxLifetimeSeconds },
  logger?:   LoggerConfig,
})
```

Only `tenant` and `credentials.backend` required. Tenant validated at
construction; throws a clear message on violation.

### 3.2 Auth layer

`AuthContext` (unchanged): `service | anonymous | customer | raw`.
`resolveToken(ctx)`:
- `service` → `TokenProvider.getToken(ctx.credentials ?? 'backend')`
- `anonymous` → `TokenProvider.getAnonymousToken()`
- `customer` / `raw` → return supplied token verbatim

`TokenProvider` — three distinct paths:
- **service / custom**: `POST /oauth/token` `client_credentials`; cache per
  credential-set key; `expirationBufferSeconds` (default 60); `maxLifetimeSeconds`
  (default 3600) hard cap; per-key promise lock for concurrent-request safety;
  `EmporixAuthError` on 4xx with parsed body. No refresh token → re-auth.
- **anonymous**: `GET /customerlogin/auth/anonymous/login`; cache with its
  `sessionId`; renew via `/anonymous/refresh` to **preserve `sessionId`**;
  same buffer/lock model.
- **external injection**: if `config.tokenProvider` is set, the SDK delegates
  `service` and `anonymous` resolution to it.

`auth` helper exported: `auth.service(credentials?)`, `auth.anonymous()`,
`auth.customer(token)`, `auth.raw(token)`.

Per-service default `AuthContext` (unchanged from brief): customer
signup/login/password-reset default `anonymous`; `me`/`update`/`changePassword`/
`addresses.*` require `customer`|`raw` (throw `EmporixAuthError` at facade if
omitted); product/category reads default `anonymous`, writes default `service`;
**all cart methods require an explicit `customer`|`anonymous` context**.

### 3.3 HTTP layer

Fetch wrapper resolves `AuthContext` → `Authorization: Bearer`. 401 asymmetry:
- service/anonymous (SDK-managed) → invalidate cache, refresh (anonymous via
  refresh endpoint, keeping `sessionId`), retry **once**
- customer/raw (caller-managed) → no retry; throw `EmporixAuthError` immediately

Retries 5xx + 429 with exponential backoff + jitter (default 3), respects
`Retry-After`. Maps non-2xx → typed `EmporixError` subclasses
(401→Auth, 403→Forbidden, 404→NotFound, 400/422→Validation, 5xx→Server).
Request/response interceptors for logging + a `tracer` hook (OTel-friendly).
`AbortController` timeouts. Logs token **kind** only, never the value.

### 3.4 Services (build order: Customer → Product → Category → Cart)

Facade pattern per brief. Corrected customer signatures:

```ts
customers.anonymous(): Promise<AnonymousSession>
  // { accessToken, refreshToken, sessionId, expiresIn }
customers.signup(input, auth?: AuthContext): Promise<Customer>          // default anonymous
customers.login({ email, password }, opts?: { anonymousToken?: string }, auth?: AuthContext)
  : Promise<CustomerSession>
  // { customerToken, saasToken, refreshToken, customer }; threads anonymousToken so sessionId/cart survive
customers.refresh(refreshToken: string): Promise<CustomerSession>      // caller-invoked; SDK never auto-refreshes caller tokens
customers.me(auth: AuthContext): Promise<Customer>                     // requires customer|raw
customers.update(patch, auth: AuthContext): Promise<Customer>
customers.changePassword({ old, new }, auth: AuthContext): Promise<void>
customers.requestPasswordReset({ email }, auth?: AuthContext): Promise<void>
customers.confirmPasswordReset({ token, newPassword }, auth?: AuthContext): Promise<void>
customers.addresses.{list,add,update,remove}(..., auth: AuthContext)
```

Product, Category, Cart signatures exactly as the brief.
`carts.merge(anonymousCartId, auth)` requires `{ kind: 'customer' }`; the
anonymous→login→merge flow works because `customers.login` preserved
`sessionId`. Pagination: `Page<T>` for `list()`, `AsyncIterable<T>` for
`listAll()`, both forwarding the same `AuthContext` to every page.

### 3.5 Logging

Exactly as the brief: `Logger` interface; numeric levels
(`trace10<debug20<info30<warn40<error50<silent60`); per-service `LevelResolver`;
resolution chain `EMPORIX_LOG_LEVEL_<SVC>` > `EMPORIX_LOG_LEVEL` >
`config.logger.services[svc]` > `config.logger.level` > `'warn'`; console +
noop loggers; runtime `setLogLevel`/`getLogLevel` (env levels sticky unless
`force`); mandatory, non-reducible redaction (default key set incl. `token`,
`secret`, `authorization`, …; `AuthContext` logged as `{ kind }` only;
`Authorization` → `Bearer ***redacted***`); early-return perf guard;
`MemoryLogger` test helper. pino/winston adapters documented, not shipped.
`ServiceName = 'customer'|'product'|'category'|'cart'|'http'|'auth'`; HTTP and
auth always log under their own names.

### 3.6 React package (`@viu/emporix-sdk-react`)

Exactly as the brief: zero React dependency in core; `react` +
`@tanstack/react-query` v5 peer deps (React 18 + 19); `EmporixProvider` +
`useEmporix`; pluggable `TokenStorage` (memory default SSR-safe; opt-in
localStorage + cookie adapters); `useCustomerSession` (lazy anonymous token on
first cart interaction, auto `carts.merge()` after login if an anonymous cart
existed — now correct because core preserves `sessionId`); query hooks
(product/products/productsInfinite/category/categories/categoryTree/cart),
namespaced keys `['emporix', resource, id, { tenant, authKind }]`;
`useCartMutations` with optimistic update + rollback; `EmporixErrorBoundary` +
`useEmporixErrorHandler`; SSR/RSC helpers (`dehydrate*`/`prefetch*`), client
created once per server, token via `initialCustomerToken`; subpath exports;
example apps `next-app-router`, `vite-spa`, `node-server`.

## 4. Versioning & Release

Exactly as the brief. Conventional Commits (commitlint + husky `commit-msg`)
for history hygiene only; husky `pre-commit` runs `pnpm lint && pnpm typecheck`.
Changesets drive versions: `.changeset/config.json` with
`changelog: @changesets/changelog-github { repo: "viuteam/emporix-sdk" }`,
`access: public`, `updateInternalDependencies: patch`, `linked: []`,
`ignore: ["@viu/emporix-examples-*"]`, `commit: false`. Two-PR release model via
`release.yml`; PR enforcement via `changeset-check.yml` (`no-release` label
override); pre-release `next` dist-tag flow documented.

## 5. Testing

Per brief: TokenProvider (caching, locks, buffer, error mapping, anonymous
cache + refresh preserving `sessionId`); `AuthContext` resolution (all four
kinds, named credentials, missing-required → facade `EmporixAuthError`,
SDK-managed vs caller-managed 401 asymmetry); HTTP (retry, timeout, error
mapping, `Retry-After`); Logger (level filtering, per-service, env precedence,
redaction, child loggers, runtime mutation, sticky env levels); `msw`
integration per service (same endpoint anonymous vs customer asserts differing
`Authorization`; anonymous create → login → merge with `sessionId` preserved;
`auth.service('partner')` hits the right credential set); React tests (provider
missing throws; login stores token + invalidates; logout clears; anon→customer
merge after login; SSR hydration matches CSR). Tenant injection coverage.
Secret-leak scan over `MemoryLogger` happy-path output. Coverage
lines/branches ≥ 80% per package.

## 6. Documentation

Per brief: root README (monorepo + two-PR release); `packages/sdk/README`
(install, quick start, config table, `AuthContext`-per-method table, logging
guide); `packages/react/README`; JSDoc `@example` on every public symbol naming
its default `AuthContext`; per-package generated `CHANGELOG.md`;
`CONTRIBUTING.md` (Conventional Commits + when/how to `pnpm changeset` for
sdk-only/react-only/both, `no-release`, pre-release); `docs/logging.md`,
`docs/auth.md` (incl. `sessionId` threading + SSO seam), `docs/react.md`.

## 7. Implementation milestones (one plan, phased)

Each phase ends with `pnpm typecheck && pnpm test && pnpm build`, a
Conventional-Commit commit, and `pnpm changeset` declaring release intent.

1. Monorepo scaffold (workspace, root pkg, shared tsconfig base, Changesets,
   husky + commitlint, `release.yml` + `changeset-check.yml`).
2. `@viu/emporix-sdk` scaffold (tsup, vitest, eslint `no-console`, prettier).
3. Core: `config.ts`, `errors.ts`, `logger.ts` (`LevelResolver` + per-service),
   `auth.ts` (`TokenProvider` 3 paths + `AuthContext` resolver), `http.ts` —
   with the full test matrix (redaction, level/env precedence, four
   `AuthContext` kinds, refresh-and-retry asymmetry, anonymous `sessionId`
   preservation).
4. Generation script + vendored Customer spec → generate types.
5. `CustomerService` e2e + tests (anonymous → login threading `sessionId` →
   me/update; addresses; field mapping accessToken→customerToken, surface
   saasToken).
6. `ProductService` e2e + tests (anonymous read + customer personalized read,
   same endpoint, differing `Authorization`).
7. `CategoryService` e2e + tests.
8. `CartService` e2e + tests (anonymous → login → merge with preserved
   `sessionId`; refuses calls without explicit `AuthContext`).
9. Client aggregator + public/subpath exports + `auth` helper, verified.
10. `@viu/emporix-sdk-react` scaffold (peer deps, tsup, vitest + jsdom).
11. Provider + memory storage + `useEmporix` + `useCustomerSession` + tests.
12. Query hooks (product/category/cart) + tests.
13. `useCartMutations` optimistic + rollback + tests.
14. localStorage + cookie storage adapters + tests.
15. SSR helpers + `examples/next-app-router` runnable.
16. `examples/vite-spa` runnable.
17. `examples/node-server` runnable.
18. Docs: READMEs, CONTRIBUTING, `docs/logging.md`, `docs/auth.md`,
    `docs/react.md`.

## 8. Out of scope (now)

Browser-specific bundle; webhook signature verification; full SSO
authorization-code flow (seam only via `raw`/custom `TokenProvider`); Tax /
Indexing / Configuration / Payment / Order services; built-in OpenTelemetry
(the `tracer` hook is the seam); React 19 `use()` adoption (await react-query).

## 9. Best practices enforced

No committed secrets (`.env.example` only); never edit `src/generated/`; JSDoc
on every export; no default exports; all errors extend `EmporixError`;
discriminated unions for `oneOf`; `AuthContext` per-call never stored; token
values never in logs/errors/traces (kind only); customer/raw 401 propagates,
service/anonymous 401 transparently refreshed; `no-console` lint on
`packages/*/src/**` (except `logger.ts`); HTTP/auth log under own service
names; secret-leak unit test; React package imports only the published
`@viu/emporix-sdk` interface; core usable without React; hooks SSR-safe and
resilient to pre-load storage.

When the vendored OpenAPI spec disagrees with portal docs, trust the spec and
flag it in a code comment.
