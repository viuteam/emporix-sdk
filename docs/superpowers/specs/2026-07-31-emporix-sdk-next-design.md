# `@viu/emporix-sdk-next` — Design

**Date:** 2026-07-31
**New package:** `@viu/emporix-sdk-next` v0.1.0
**Prerequisite change:** `@viu/emporix-sdk` minor (injectable `fetch`)
**Depends on:** `@viu/emporix-sdk-react@2.25.0`'s `./ssr` surface (PR #182, merged 2026-07-31)

## Goal

A Next.js-specific layer so that every viu storefront gets the same server-side
wiring instead of re-deriving it: one client per process, session from cookies,
and — the part only Next can do — tag-based cache invalidation driven by Emporix
webhooks.

## Why a package and not a `docs/nextjs.md`

Decided by the user on 2026-07-31: **multiple Next storefronts are planned.** With
one storefront a docs page wins; with several, the glue drifts independently in
each repo. The business logic is small, and that is accepted — the value is the
clean boundary and a single place to fix a bug.

This reverses the recommendation in the earlier evaluation, which leaned toward
docs *on the assumption of a single storefront*. The assumption was wrong, so the
conclusion changes.

## Current state (measured 2026-07-31)

| Fact | Evidence |
|---|---|
| The SDK has **no** fetch injection point | 0 matches for `fetch?:` / `fetchImpl` / `customFetch` in `packages/sdk/src`. `EmporixConfig`, `RequestOptions` and `HttpClientOptions` all lack one. |
| A per-request `fetchOptions` field would be unreachable | 596 `this.ctx.http.request<…>({…})` call sites across `packages/sdk/src/services/*.ts`, each building its own `RequestOptions` literal. Adding a field there reaches no service method without editing all 596. |
| Only 2 fetch sites need wiring | `core/http.ts:141` (main request path) and `core/http.ts:277` (raw path). |
| Monorepo config is glob-based | `pnpm-workspace.yaml` → `packages/*`; root `build`/`test`/`lint` → `--filter "./packages/*"`; `pr-check.yml` build step → `pnpm -r --filter "./packages/*" build`; changesets `ignore: ["@viu/emporix-examples-*"]`. **A new package needs zero workflow or config changes.** |
| Webhook signing is documented | Emporix Webhook Service `HttpConfig.secretKey`: HMAC-SHA256 over the payload, delivered in the `emporix-event-signature` header. An `emporix-event-publish-time` header (RFC3339 UTC) accompanies every delivery. |
| Next target | `examples/next-app-router` runs `next@^15.5.19`, React 19.2.7. |

## Non-goals for v0.1

- **Middleware** for site/locale detection. A storefront may never need it; add on
  request.
- **`next/image`.** `docs/media.md` documents no transform parameters — PUBLIC
  assets resolve to a storage URL. What consumers need is a `remotePatterns`
  entry, which is documentation, not code.
- **`"use cache"` / `cacheLife`.** Those need `experimental.cacheComponents` in
  Next 15. The stable path (`next: { tags, revalidate }` on fetch +
  `revalidateTag`) covers the requirement without an experimental flag.
- **Joining the changesets `linked` group.** `linked` currently pairs
  `@viu/emporix-sdk` with `@viu/emporix-sdk-react`, both at 2.x. Coupling a fresh
  0.x to a 2.x makes every unrelated SDK release bump this package.
  `@viu/emporix-mixins` (0.2.0, unlinked) is the precedent. Revisit at 1.0.

---

## Phase 0 (prerequisite) — injectable `fetch` in `@viu/emporix-sdk`

Folded into this spec rather than given its own: it is two config lines plus two
call sites and carries no independent design question. It still ships as its own
PR with its own changeset, because it releases a different package.

```ts
// core/config.ts — EmporixConfig
/**
 * Replaces the global `fetch` for API requests. Receives the same arguments.
 * Token requests and SSE deliberately keep using the global `fetch` — see below.
 */
fetch?: typeof globalThis.fetch;
```

Threaded to `HttpClientOptions.fetch?` and used at:

- `core/http.ts:141` — the main request path
- `core/http.ts:277` — the raw path

**Deliberately NOT wired:**

| Site | Why |
|---|---|
| `core/auth.ts:252` — token requests | A cached OAuth token response would be a security defect. Leaving this on the global `fetch` makes token requests *structurally* uncacheable, not merely uncached by convention. |
| `core/http.ts:313` — SSE | Caching a `text/event-stream` is meaningless, and a tagging wrapper would have to special-case it. |

Default stays `globalThis.fetch`, so behaviour is unchanged when the option is
absent. Value beyond Next: tracing, test doubles, custom retry policies.

---

## Component 1 — URL-derived cache tags

Because tags cannot be attached per call (596 call sites), the package derives
them from the request URL inside its injected `fetch`. This is the heart of the
package and the main reason it beats a snippet: the mapping lives in one place
and cannot be forgotten at a call site.

```ts
export function emporixTagsForUrl(url: string, tenant: string): string[];
```

Mapping, against the real path shapes in `packages/sdk/src/services/`:

| Path shape | Tags |
|---|---|
| `/product/{tenant}/products/{id}` | `emporix:product:{id}`, `emporix:products` |
| `/product/{tenant}/products` | `emporix:products` |
| `/category/{tenant}/categories/{id}` | `emporix:category:{id}`, `emporix:categories` |
| `/category/{tenant}/categories/{id}/subcategories` \| `/parents` \| `/assignments` | `emporix:category:{id}`, `emporix:categories` |
| `/category/{tenant}/categories` | `emporix:categories` |
| `/category/{tenant}/category-trees/{id}` | `emporix:category-tree:{id}`, `emporix:categories` |
| `/price/{tenant}/…` | `emporix:prices` |
| `/availability/{tenant}/…` | `emporix:availability` |
| `/site/{tenant}/sites…` | `emporix:sites` |
| anything else | `[]` — no tags, so no caching |

**The trap this must not fall into.** These paths are real and all look like
`/products/{id}` to a naive matcher:

```
/product/{tenant}/products/bulk
/product/{tenant}/products/search
/product/{tenant}/products/recalculate
/product/{tenant}/products/recalculate/jobs
/product/{tenant}/products/recalculate/jobs/{jobId}
/category/{tenant}/categories/search
/category/{tenant}/category-trees/search
```

A naive mapper emits `emporix:product:bulk` and `emporix:product:search`. The
mapper therefore keeps a **reserved-segment set** — `bulk`, `search`,
`recalculate`, `jobs` — and treats a match against it as "collection", not "id".
A test asserts each reserved path produces the collection tag and no id tag.

**Safety rule 1: only GET is tagged.** Mutations must never be cached, and Next
only caches GET anyway; the wrapper asserts the method rather than relying on
that.

**Safety rule 2: personalization is separated by client, not detected.** A shared
cache entry for a personalized response is a data leak, and Next's fetch cache
does not key on the `Authorization` header — so an incorrectly cached
customer-scoped response would be served to other visitors.

The wrapper **cannot** distinguish an anonymous from a customer request:
`AuthContext` is per call by design, both arrive as `Bearer <jwt>`, and telling
them apart would mean decoding the token and betting on Emporix claim names that
have not been verified. An earlier draft of this spec proposed exactly that
header inspection; it does not work.

Instead the boundary is explicit at construction:

```ts
getEmporixClient()                    // tagged + cacheable — anonymous catalog reads only
getEmporixClient({ tagged: false })   // untagged — anything with a customer token
```

Both are memoized, so this is still a bounded number of clients per process, not
one per request. The caller always knows whether a read is personalized, so the
decision belongs to them; making it implicit is what would introduce the leak.
The README states the rule in one line: **a customer token never goes through the
tagged client.**

Tested by asserting that the tagged client attaches tags and the untagged client
attaches none, and that a POST through the tagged client is untagged.

## Component 2 — client and session

```ts
export function getEmporixClient(
  opts?: Partial<EmporixConfig> & {
    /** Attach cache tags to GET requests. Default `true`. MUST be `false` for
     *  any client used with a customer token — see Component 1, safety rule 2. */
    tagged?: boolean;
    /** Seconds; becomes `next: { revalidate }` on tagged GETs. Default 3600. */
    revalidate?: number;
  },
): EmporixClient;
```

Memoized per process (module-level, keyed by `tenant` + `tagged` + `revalidate`,
so the tagged and untagged clients are two stable instances rather than one per
call), reading `EMPORIX_TENANT` / `EMPORIX_STOREFRONT_CLIENT_ID` from the
environment unless overridden. Wires the tagging `fetch` from Component 1 when
`tagged` is true. Solves the concrete
problem in `examples/next-app-router`, which today holds two independent
module-scope `EmporixClient` instances (`app/actions.ts` and
`app/product/[id]/page.tsx`) and therefore two token caches.

```ts
export interface EmporixServerSession {
  storage: EmporixStorage;
  auth: AuthContext;
  customerToken: string | null;
  cartId: string | null;
  siteCode: string | null;
  language: string | null;
  legalEntityId: string | null;
}
export function emporixSession(): Promise<EmporixServerSession>;        // read-only
export function emporixSessionMutable(opts?: {
  sameSite?: "lax" | "strict" | "none";
  secure?: boolean;
}): Promise<EmporixServerSession>;
```

Both are thin: `await cookies()` → `createServerStorage(...)` →
`serverAuth(...)`, all three from `@viu/emporix-sdk-react/ssr`. The value is that
no storefront writes the jar adapter or the `httpOnly` cookie attributes again.

`emporixSession()` omits `set`, so the storage is read-only and a write attempt
warns rather than throwing inside a render — matching what Next allows.
`emporixSessionMutable()` supplies `set` with `httpOnly: true, path: "/",
secure: true, sameSite: "lax"` defaults and is only valid in Server Actions and
Route Handlers.

**Documented footgun, inherited:** an `httpOnly` customer-token cookie written
here is unreadable by the browser-side `createCookieStorage`. The supported
pattern stays `initialCustomerToken` into the provider. Restated in this
package's README because this is where people will hit it.

## Component 3 — webhook route and revalidation

```ts
export function verifyEmporixSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  opts?: { encoding?: "base64" | "hex" },
): boolean;

export function createEmporixWebhookRoute(opts: {
  secret: string;
  /** Extra work after revalidation. Throwing returns 500 and Emporix retries. */
  onEvent?: (event: EmporixWebhookEvent) => Promise<void> | void;
  /** Reject deliveries older than this, against `emporix-event-publish-time`. */
  maxAgeSeconds?: number;
}): (req: Request) => Promise<Response>;
```

The handler reads the raw body (required — a re-serialized body breaks HMAC),
verifies the signature, checks the publish-time window, maps the event type to
tags and calls `revalidateTag` for each. Signature failure returns 401 without
revalidating.

Comparison uses `crypto.timingSafeEqual` on equal-length buffers, never `===`.

### Resolved: the signature contract is documented, and it is not what this spec first assumed

**Correction, 2026-07-31.** An earlier version of this section called the
encoding an unknown, because the Webhook Service API reference describes the
signature as *«encoded to `BASE256`»* — not a real encoding. It then required an
empirical capture before the verifier could ship.

Emporix documents the verification explicitly on
[HTTP Webhook Strategy — HMAC Configuration](https://developer.emporix.io/ce/system-management/webhooks-user-guide/hmac-configuration),
with a worked example. Two things follow, and the second reverses an assumption
this spec made twice:

1. **The encoding is base64.** `BASE256` in the API reference is an error.
2. **The HMAC is computed over a canonically re-serialized body, not over the
   raw bytes.** Emporix's example runs the parsed body through
   `json-stable-stringify`, and the page states why: *«to order all the fields
   and nested objects alphabetically which allows maintaining the correct
   order»*. An earlier draft of this spec asserted the opposite — that the raw
   bytes were required and that re-serializing would break the HMAC. For Emporix
   the reverse is true: canonicalization is mandatory.

Consequence for the no-runtime-dependencies rule: `json-stable-stringify` is not
added. A recursive key-sort plus `JSON.stringify` is ~15 lines and produces the
same output for JSON values (both emit no whitespace and identical escaping).

**Remaining honest limitation.** This follows the vendor's published example but
has **not** been verified against a live delivery. Emporix's own documentation
already contained one error on exactly this topic, and their SQS integration
example uses a plain `JSON.stringify(event.body)` without stable ordering, which
contradicts the HMAC page. The HMAC page is treated as authoritative because it
explains its reasoning. The README and PR must state that one real delivery
should be smoke-tested before production use, and `canonicalize: false` exists as
an escape hatch if a tenant turns out to sign raw bytes.

`EmporixWebhookEvent` will be typed from the payload observed in that same
capture, not from an assumed shape.

## Package layout

```
packages/next/
  package.json          name @viu/emporix-sdk-next, version 0.1.0
  tsconfig.json         extends ../../tsconfig.base.json
  tsup.config.ts        entries: index, webhook
  README.md
  src/
    index.ts            getEmporixClient, emporixSession(+Mutable), tags
    client.ts           memoized client + tagging fetch
    session.ts          cookie-jar wiring over ./ssr
    tags.ts             emporixTagsForUrl + reserved segments + tag constructors
    webhook.ts          verifyEmporixSignature + createEmporixWebhookRoute
  tests/
    tags.test.ts        mapping, reserved segments, unknown paths
    fetch-tagging.test.ts   GET-only, customer-token skip, tag attachment
    client.test.ts      memoization keyed by tenant+tagged+revalidate
    session.test.ts     read-only vs mutable, cookie attributes
    webhook.test.ts     signature accept/reject, replay window, tag calls
```

```json
"exports": {
  ".":            { "types": "./dist/index.d.ts",   "import": "./dist/index.js",   "require": "./dist/index.cjs" },
  "./webhook":    { "types": "./dist/webhook.d.ts", "import": "./dist/webhook.js", "require": "./dist/webhook.cjs" },
  "./package.json": "./package.json"
}
```

Dependencies: `next` (peer, `^15.0.0` — `revalidateTag` and fetch-level
`next: { tags }` have been stable since Next 13, so no tighter floor is needed),
`@viu/emporix-sdk` (peer, `workspace:^`), `@viu/emporix-sdk-react` (peer,
`workspace:^`). No runtime dependencies. `files: ["dist", "README.md", "LICENSE"]`
matching the react package rather than mixins, which ships `dist` only.

**Everything in this package is server-only**, so there is no `"use client"`
boundary to guard and therefore no analogue of the react package's `check:dist`.
A Client Component that imports it fails at build time anyway, because
`next/headers` and `next/cache` are server-only modules that Next rejects in a
client graph — that is the guard, and it belongs to Next, not to us.
`./webhook` is a separate entry only so a route handler does not pull the
client/session code.

## Testing

`next/headers` and `next/cache` are the only Next imports, and both are mocked
with `vi.mock` — the tests must not need a running Next server. `emporixSession`
is tested against a fake `cookies()` returning the same shape Next's does
(`{ get(name) => { value } | undefined, set, delete }`).

The fetch-tagging tests assert behaviour through a real `EmporixClient`
configured with the package's fetch, with MSW answering — that is the only way
to prove the wiring works end to end rather than testing the wrapper in
isolation.

## Sequencing

1. ~~PR #182 — `@viu/emporix-sdk-react` minor~~ **merged 2026-07-31**
2. PR — `@viu/emporix-sdk` minor: injectable `fetch` (Phase 0)
3. PR — `@viu/emporix-sdk-next` 0.1.0

Step 3 can be developed against `workspace:*` immediately, but cannot be
published until step 2 is on npm.

## Follow-ups

1. Migrate `examples/next-app-router` onto the package — it is the acceptance
   test for whether the surface is actually pleasant.
2. Middleware for site/locale detection, on request.
3. `docs/nextjs.md` with the `remotePatterns` entry for `next/image`.
4. The still-open key-normalization PR from the previous cycle: move
   `useAvailability` / `useAvailabilities` onto `emporixKey` and fix the
   `prefetchOrder` / `useOrder` `authKind` mismatch.
