# Host-owned customer sessions: running the React package inside a Managed Dashboard module

**Status:** design, 2026-08-10. Not yet implemented.
**Date:** 2026-08-10
**Affects:** `packages/react/src/provider.tsx`, `provider.types.ts`,
`hooks/internal/use-company-bootstrap.ts`, `hooks/internal/use-customer-token-refresher.ts`,
`docs/react.md`; a new `examples/md-module`
**Origin:** Emporix ships [`emporix/md-module-template`](https://github.com/emporix/md-module-template),
a Module-Federation remote for the Managed Dashboard. The question was whether
`@viu/emporix-sdk-react` can serve it.

## The situation

The template is a Vite + React 18 federation remote (`@originjs/vite-plugin-federation`,
name `extension`, exposing `./RemoteComponent` as `remoteEntry.js`). The Managed Dashboard
at `https://admin.emporix.io` loads it and passes exactly three values:

```ts
// src/models/AppState.model.ts
export type AppState = { tenant: string; language: string; token: string }
```

The module never authenticates. Its data layer today is `@emporix/api-calls`, wired with
`getAccessToken: () => credentials.token`.

**The token is a customer token whose scopes cover operations that a storefront customer
token could not reach** — endpoints that otherwise need client-id + secret. The Managed
Dashboard operator is a customer in the OAuth sense and an administrator in the permission
sense. That single fact is what makes this a React-package problem rather than a
core-SDK-only one: with a customer token in hand, the whole hook surface becomes available,
and `EmporixProvider` already has the seam for it.

## What already works

`EmporixProvider` takes `initialCustomerToken`. With it:

- `useEmporixQuery` resolves `readCtx = token ? auth.customer(token) : auth.anonymous()`,
  so **every** `read-auth` hook uses the host token with no per-call override.
- `mode: "customer"` hooks (`useOrder`, `useMyOrders`, cart, checkout) work too — they read
  the token from storage. Under the `auth.raw()` alternative these were unusable, because
  that mode hard-codes `auth.customer(...)` and ignores `authOverride`.
- The query key writes `authKind: "customer"`, the normal path. No `"raw"` namespace, and
  none of the prefetch-parity footgun documented in `docs/react.md`.
- `SiteContextProvider` fetches the site with `auth.customer(token)`, so site-derived
  currency and `targetLocation` resolve instead of silently failing.
- A client with no credentials at all is legal: `validateConfig` only requires the
  `credentials` object to exist, and `DefaultTokenProvider`'s constructor is
  `constructor(private readonly cfg) {}` — credential checks are lazy, inside `getToken`
  and `getAnonymousToken`, neither of which a customer-kind request calls. So
  `createEmporixClient({ tenant, host, credentials: {} })` constructs and works.

So the integration is mostly a matter of passing one prop. What follows are the three
places where it is not.

## Three gaps

### 1. The provider fires an unrequested B2B call on mount

`useCompanyBootstrap`'s `load` runs in a mount effect and, whenever a customer token is
present, calls:

```ts
const companies = await client.companies.listMine(auth.customer(token));
```

For a Managed Dashboard identity this is a request for the legal entities of a shop
customer who does not exist. Expect a 403 or an empty list; either way the module paid a
round trip it never asked for and the company context lands in `status: "error"`.

It is worse on rotation — see gap 3: a new token recreates storage, the effect re-runs, and
the call is made again.

### 2. The module cannot learn that the token died

`useCustomerTokenRefresher` opens with `if (!enabled) return`. So
`onCustomerSessionExpired` fires **only** when `autoRefreshCustomerToken` is true — and for
a host-owned token that flag is exactly wrong: there is no refresh token, and the SDK must
not attempt to mint one.

The flag *would* produce the desired callback by accident (no stored refresh token →
`refresh()` returns null → `onExpired()`), but that relies on an implementation detail while
declaring the opposite intent at the call site. A module that reads
`autoRefreshCustomerToken` as "yes, refresh my token" and gets "no, just tell me it died"
is a trap for the next reader.

Without either, a 401 surfaces as a bare `EmporixAuthError` from whichever query happened to
run, and each module re-implements its own detection.

### 3. Token rotation works only by accident, and only one way

```ts
const value = useMemo(() => {
  const s = storage ?? createMemoryStorage(
    initialCustomerToken !== undefined ? { initial: initialCustomerToken } : {});
  return { client, storage: s };
}, [client, storage, initialCustomerToken]);
```

With the memory fallback, a changed `initialCustomerToken` builds a **new storage object**.
The token is picked up, but everything else in storage is discarded and every effect keyed
on storage identity re-runs — including gap 1.

With a caller-supplied `storage` prop it does not work at all: `useProviderWiring` seeds it
only `if (externalStorage.getCustomerToken() === null)`, so a rotated token is ignored.

A host that re-renders the remote with a fresh token is the expected refresh mechanism here,
so this is the path that has to be deliberate rather than incidental.

## Design

### One prop, because the three behaviours travel together

```ts
/**
 * Who owns the customer token.
 *
 * `"owned"` (default) — the SDK's storefront model: the token came from a login
 * this provider performed or restored, may be refreshed, and belongs to a shop
 * customer who may have legal entities.
 *
 * `"external"` — the token was handed in by a host (Managed Dashboard module,
 * embedded admin UI). The SDK never refreshes it, never bootstraps a company
 * context from it, and accepts a replacement through `initialCustomerToken`.
 */
customerSession?: "owned" | "external";
```

A mode rather than three independent flags because an externally-owned token implies all
three consequences at once, and the name documents *why* at the call site. Three booleans
would let a caller assemble a combination that has no meaning (`no refresh` + `bootstrap
companies`), and would say nothing about the reason.

`customerSession="external"` changes exactly three things:

1. **No company bootstrap.** `CompanyContextProvider` still renders so `useActiveCompany()`
   keeps working, but `useCompanyBootstrap` skips its `listMine` load and reports
   `mode: "b2c"`, `status: "idle"`, `myCompanies: []`.

   It must **not** simply hand out `NULL_CTX`: that value's `setActiveCompany` throws
   `"CompanyContextProvider not mounted"`, which would be false here — the provider is
   mounted, it just has nothing to switch between. External mode needs its own idle value
   whose `setActiveCompany` rejects with a message naming the real reason
   (`"customerSession is \"external\": no company context is bootstrapped"`). A misleading
   error costs more than the branch that avoids it.

   A module that genuinely wants company data calls `client.companies.listMine(...)` itself.
2. **Expiry is reported, never repaired.** Mechanically this still goes through
   `client.setCustomerTokenRefresher`, because that is the only hook the HTTP layer offers
   on a `customer`-kind 401 — but in external mode the registered refresher does nothing
   except call `onCustomerSessionExpired` and return `null`, so the 401 propagates as
   `EmporixAuthError`. It never reads `storage.getRefreshToken()` and never issues a
   request. That distinction matters: the same end state reached by enabling
   `autoRefreshCustomerToken` and relying on an absent refresh token would be an accident of
   the current implementation, not a contract.

   `autoRefreshCustomerToken` is therefore ignored in this mode. Passing both is a
   contradiction and warrants a dev-mode warning rather than a silent precedence rule.
3. **Rotation writes into the existing storage.** When `initialCustomerToken` changes,
   the provider calls `storage.setCustomerToken(next)` instead of rebuilding storage — so
   the rest of the session survives, dependent effects do not re-run, and the path works
   with a caller-supplied storage too.

### What the module passes

```tsx
<EmporixProvider
  client={clientFor(appState.tenant)}
  initialCustomerToken={appState.token}
  initialLanguage={appState.language}
  customerSession="external"
  onCustomerSessionExpired={() => setTokenDead(true)}
>
```

`initialLanguage={appState.language}` is not decoration. Left unset, the provider seeds the
language from the active site's `defaultLanguage` **after** mount, which moves the query key
and orphans anything already fetched under the old one — the defect measured in
[PR #249](https://github.com/viuteam/emporix-sdk/pull/249). The host already knows the
language; taking it removes the asynchrony entirely.

**No `storage` prop.** The memory fallback is correct here for a reason beyond convenience:
a federation remote runs on the host's origin, so `createLocalStorage` would write
`emporix.customerToken` into `admin.emporix.io`'s `localStorage` — the host's namespace, for
a token the host already owns. Memory storage keeps the token's lifetime equal to the
module's.

### Client identity

One client per tenant, memoized on tenant and **not** on the token: the token is a request
credential, not part of client identity, and rebuilding the client on rotation would discard
its caches. `host` comes from the template's existing `VITE_API_URL`, whose dev value
(`https://api-develop.emporix.io`) differs from the SDK's `DEFAULT_HOST`, so it must be
passed explicitly.

`tenant` must satisfy the SDK's guard `^[a-z][a-z0-9]{2,15}$`. The template's dev fallback
`'default'` passes; a host value that does not would throw at construction, which is the
right moment to find out.

### Federation

`react` and `react-dom` stay in the template's `shared` array — two React copies break every
hook. `@viu/emporix-sdk`, `@viu/emporix-sdk-react` and `@tanstack/react-query` are **not**
shared: the host does not know our versions, and the module owns its own `QueryClient` and
cache lifetime. Our React peer range is `^18.0.0 || ^19.0.0`, so the template's React 18.3
is in range, and the SDK itself is dependency-free.

## Testing

| what | where |
|---|---|
| `customerSession="external"` makes no `companies/mine` request on mount, with a token present | `packages/react/tests/` — new |
| `"owned"` (and the default) still bootstraps companies | existing company-bootstrap tests must keep passing untouched |
| a `customer` 401 in external mode calls `onCustomerSessionExpired` and rejects with `EmporixAuthError`, and issues no refresh request | new, MSW |
| a changed `initialCustomerToken` in external mode reaches the next request and preserves other storage fields | new |
| the same change with a caller-supplied `storage` also lands | new — this is the case that silently fails today |
| passing `autoRefreshCustomerToken` together with `"external"` warns and does not refresh | new |
| `setActiveCompany` in external mode rejects with the external-mode reason, not "provider not mounted" | new |

`examples/md-module` is the acceptance surface: a federation remote wired exactly as above,
listing products through `useProducts` with `totalCount: true` so the dashboard's table can
show "X of Y". It is an example, so it is under `.changeset/config.json`'s `ignore` and is
not published.

## Deliberately not in scope

- **No `auth.raw` path.** It exists and would work for the core SDK, but with a customer
  token the `customer` kind is the honest description, keeps `mode: "customer"` hooks
  working, and avoids the `authKind: "raw"` key namespace.
- **No token refresh of any kind.** The host owns the token's lifecycle. Reporting is the
  module's whole job.
- **No storefront session features.** Anonymous sessions, cart-id persistence and site
  switching stay available but unused; a dashboard module has no shopper.
- **No change to `validateConfig`'s message.** It says "provide at least one of
  backend/storefront/custom" while only checking that the object exists. That mismatch is
  what makes a credential-free client possible, and this design depends on it — worth a
  separate fix that keeps the behaviour and corrects the text.

## Assumptions to verify before implementing

1. **The token's scopes.** The premise is that the Managed Dashboard token reaches
   operations normally requiring client-id + secret. Which facades are actually usable
   follows from the granted scopes, and nothing here has been measured against a live
   dashboard token. If the scopes turn out narrower than assumed, the design still holds —
   the set of usable hooks shrinks, not the wiring.
2. **How the host signals a new token.** The template has no refresh path; whether the
   dashboard re-renders the remote with a fresh `appState.token` or simply lets it expire is
   not documented in the repo. Gap 3's fix assumes the former. If the host does neither,
   `onCustomerSessionExpired` is the module's only recourse and the UI must ask the operator
   to reload.
3. **`@emporix/component-library` resolvability.** It did not resolve from the public npm
   registry, so the template may need registry access to build at all. Independent of this
   design, but it blocks the example.
