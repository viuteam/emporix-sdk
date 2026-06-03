# Opt-in Customer-Token Auto-Refresh — Design

**Date:** 2026-06-03
**Status:** Approved (design)
**Packages:** `@viu/emporix-sdk` (core seam) + `@viu/emporix-sdk-react` (wiring)
**Branch:** `feat/customer-token-auto-refresh`

## Problem

The SDK auto-refreshes its **SDK-managed** tokens (`service`, `anonymous`):
the `DefaultTokenProvider` caches them with an expiry buffer, and the HTTP layer
re-auths once on a 401 (`core/http.ts` — `sdkManaged` branch). The
**caller-managed** `customer` token has **no** auto-refresh: a `customer`-kind
401 throws `EmporixAuthError` immediately, and refresh is purely manual
(`client.customers.refresh()` / `useCustomerSession().refreshSession()`). The
only automatic customer refresh today is the B2B company-switch rescope.

We want an **opt-in** reactive auto-refresh: on a `customer`-token 401, refresh
once and retry the original request — without breaking the invariant that the
customer token is **caller-owned** (the SDK must not refresh it unless the host
explicitly wires that in).

## Emporix verification (confirmed via developer.emporix.io)

| Fact | Detail |
| --- | --- |
| Customer access token TTL | **30 days.** Docs: "customer access tokens expire after 30 days, you need to introduce a mechanism to prolong the session… refresh the customer token before it expires." |
| Refresh is the sanctioned mechanism | "generate a new customer token without forcing the user to log in again." |
| Endpoint | `GET /customer/{tenant}/refreshauthtoken?refreshToken=…&legalEntityId=…`, **authorized with the anonymous access token** (not the expired customer token). `legalEntityId` optional (B2B rescope). |
| Response (`RefreshCustomerToken`) | `access_token`, **`refresh_token` (rotated)**, `refresh_token_expires_in`, `expires_in`, `session_id`. **No `saas_token`.** |

**Design consequences:**
- The 30-day TTL means a **proactive scheduler adds little value** — the real
  win is **reactive on 401** (expired / revoked / stale-from-storage). Reactive
  is the chosen trigger model.
- The refresh **rotates the refresh token** → concurrent refreshes would
  invalidate each other. **Single-flight is mandatory.**
- The refresh self-authorizes with the anonymous token, which is SDK-managed —
  so the SDK can mint it automatically; no extra credentials needed.
- The refresh returns no `saas_token`; the SDK already carries the original
  forward. `saasToken` is **not persisted** to storage, so a refresh after a
  page reload cannot restore it (known limitation; re-login restores it).

## Architecture

Two layers, opt-in, off by default.

```
EmporixProvider (autoRefreshCustomerToken)        ← host opts in (React)
    └─ registers a CustomerTokenRefresher on the client
EmporixClient.setCustomerTokenRefresher(r)        ← late-bound, shared
    └─ CustomerRefreshRegistry (single-flight)    ← core
        └─ HttpClient (per service) consults it on a customer-401
```

### Core seam — `@viu/emporix-sdk`

**`CustomerTokenRefresher` interface** (new, in `core/auth.ts`):

```ts
export interface CustomerTokenRefresher {
  /**
   * Called when a `customer`-kind request 401s. Receives the token that just
   * failed; returns a fresh customer token to retry with, or `null` to give up
   * (the 401 then propagates as EmporixAuthError). Must tolerate concurrent
   * callers — the registry single-flights, but implementations should be
   * idempotent.
   */
  refresh(expiredToken: string): Promise<string | null>;
}
```

**`CustomerRefreshRegistry`** (new, `core/customer-refresh.ts`) — a tiny
late-bindable holder that single-flights:

```ts
export class CustomerRefreshRegistry {
  private refresher: CustomerTokenRefresher | null = null;
  private inflight: Promise<string | null> | null = null;

  set(r: CustomerTokenRefresher | null): void { this.refresher = r; }
  get enabled(): boolean { return this.refresher !== null; }

  /** Single-flight: concurrent 401s share one refresh (refresh_token rotates). */
  refresh(expiredToken: string): Promise<string | null> {
    if (!this.refresher) return Promise.resolve(null);
    if (this.inflight) return this.inflight;
    const p = Promise.resolve(this.refresher.refresh(expiredToken))
      .finally(() => { this.inflight = null; });
    this.inflight = p;
    return p;
  }
}
```

**`EmporixClient`** owns one registry, passes it into every service `HttpClient`
via `mk()`, and exposes:

```ts
setCustomerTokenRefresher(refresher: CustomerTokenRefresher | null): void;
```

(mirrors `tokenProvider.attachAnonymousStore` — late registration after
construction, affects all services because the registry is shared by reference.)

**`HttpClientOptions`** gains an optional `customerRefresh?: CustomerRefreshRegistry`.

**`core/http.ts` `request()`** — extend the 401 block. Today:

```ts
const sdkManaged = o.auth.kind === "service" || o.auth.kind === "anonymous";
```

Add a per-request token override + a customer-refresh branch:

```ts
let customerToken = o.auth.kind === "customer" ? o.auth.token : undefined;
let customerReauthed = false;
// …in the loop, token resolution prefers the override:
const token = customerToken ?? await resolveToken(o.auth, this.opts.provider);
// …in the 401 handler, AFTER the existing sdkManaged branch:
if (
  o.auth.kind === "customer" &&
  !customerReauthed &&
  this.opts.customerRefresh?.enabled
) {
  customerReauthed = true;
  const fresh = await this.opts.customerRefresh.refresh(customerToken!);
  if (fresh) {
    customerToken = fresh;
    log.warn("customer 401, refreshed once", { authKind: o.auth.kind });
    continue;             // retry with the new token
  }
}
throw errorFromResponse(res.status, `${o.method} ${o.path} → 401`, parsed);
```

Notes:
- The retry uses the returned token **directly** (local override) — it does not
  depend on the host persisting it first.
- `raw`-kind is never auto-refreshed (no refresh token semantics).
- `requestRaw()` stays out of scope (it already skips the 401-reauth path).
- With no refresher registered, behavior is **identical to today** (throws).

### React wiring — `@viu/emporix-sdk-react`

**`EmporixProvider` props** (additive):

```ts
/** Opt in to reactive customer-token auto-refresh on 401. Default: false. */
autoRefreshCustomerToken?: boolean;
/** Called when a refresh is needed but fails (refresh token expired/revoked) or
 *  no refresh token is stored. Use to drive logout / redirect to login. */
onCustomerSessionExpired?: () => void;
```

When `autoRefreshCustomerToken` is true, a provider effect registers a refresher
on the client and unregisters on unmount:

```ts
useEffect(() => {
  if (!autoRefreshCustomerToken) return;
  client.setCustomerTokenRefresher({
    refresh: async (_expired) => {
      const refreshToken = storage.getRefreshToken();
      if (!refreshToken) {                       // nothing to refresh with
        safeEmit({ type: "auth.refresh", kind: "customer", success: false, tenant: client.tenant });
        onCustomerSessionExpired?.();
        return null;
      }
      try {
        const legalEntityId = storage.getActiveLegalEntityId() ?? undefined;
        const s = await client.customers.refresh({ refreshToken, ...(legalEntityId ? { legalEntityId } : {}) });
        storage.setCustomerToken(s.customerToken);          // → notifies hooks via subscribe
        if (s.refreshToken) storage.setRefreshToken(s.refreshToken);
        safeEmit({ type: "auth.refresh", kind: "customer", success: true, tenant: client.tenant });
        return s.customerToken;
      } catch {
        safeEmit({ type: "auth.refresh", kind: "customer", success: false, tenant: client.tenant });
        onCustomerSessionExpired?.();
        return null;
      }
    },
  });
  return () => client.setCustomerTokenRefresher(null);
}, [autoRefreshCustomerToken, client, storage, onCustomerSessionExpired /* stable */]);
```

## Data flow (reactive refresh, happy path)

1. A data hook (e.g. `useMyOrders`) issues a `customer`-token request; the token
   is stale → Emporix returns **401**.
2. `http.ts` sees `customer` + refresher enabled + not-yet-retried → calls
   `registry.refresh(expiredToken)` (single-flight).
3. The React refresher reads `storage.getRefreshToken()` (+ `activeLegalEntityId`),
   calls `client.customers.refresh(...)` (auth: anonymous, self-minted), writes
   the new `customerToken` + rotated `refreshToken` to storage, returns the new
   token.
4. `http.ts` retries the **original** request with the new token → success.
5. Storage write fires `storage.subscribe` → `useCustomerSession` updates its
   `token` slot; subsequent hook renders read the fresh token from storage.

## Error handling

| Situation | Behavior |
| --- | --- |
| No refresh token in storage | refresher returns `null` → 401 propagates as `EmporixAuthError`; `onCustomerSessionExpired` fired. |
| Refresh call fails (refresh token expired/revoked, network) | refresher returns `null` → 401 propagates; `onCustomerSessionExpired` fired; `auth.refresh {success:false}` emitted. |
| Refresh succeeds but retry still 401s | not retried again (`customerReauthed` guard) → propagates. |
| Concurrent customer-401s | single-flight: one refresh, all waiters retry with the same new token. |
| Opt-in disabled (default) | unchanged — 401 throws immediately. |

## Edge cases / limitations (documented)

- **`saasToken` not restored** by auto-refresh (it isn't persisted and the
  refresh response omits it). Consumers relying on `saas-token` continuity must
  re-login. Within a live session the existing manual `refreshSession` keeps it.
- **`requestRaw` not covered** in v1 (binary/redirect endpoints; rarely
  customer-token).
- **Proactive refresh not included** (30-day TTL → low value; would require
  tracking the opaque token's expiry). Possible later extension; out of scope.
- Single client instance shared across SSR requests must **not** enable this
  with per-request customer tokens bleeding across requests — the registry is
  per-client; on the server, create the client per request (already the
  documented rule) or leave the feature to the browser provider.

## Testing strategy

**SDK core (`packages/sdk/tests/core/http.test.ts` or new):**
- customer-401 + registered refresher returning a new token → request retried
  with `Bearer <new>` and resolves.
- refresher returning `null` → `EmporixAuthError` propagates (one attempt).
- **single-flight**: two concurrent customer-401 requests → refresher invoked
  **once**; both retried with the same token.
- no refresher → 401 throws (regression guard for current behavior).
- `service`/`anonymous` paths unaffected.

**React (`packages/react/tests/auto-refresh-customer.test.tsx`):**
- provider with `autoRefreshCustomerToken` + a stored refresh token: a
  customer query 401s once, the refresh endpoint is hit (MSW) **with the
  anonymous bearer** and `refreshToken` query param, the retried query succeeds,
  storage holds the new token.
- refresh fails → `onCustomerSessionExpired` called; query surfaces the error.
- feature off → no refresher registered (refresh endpoint never hit).

## Deliverables

- **SDK:** `CustomerTokenRefresher` + `CustomerRefreshRegistry`, `http.ts`
  customer-401 branch + token override, `HttpClientOptions.customerRefresh`,
  `EmporixClient.setCustomerTokenRefresher`, barrel exports. Optionally map
  `refresh_token_expires_in` in `customers.refresh` (additive).
- **React:** `EmporixProvider` props (`autoRefreshCustomerToken`,
  `onCustomerSessionExpired`) + registration effect + `auth.refresh` telemetry.
- **Docs:** `docs/auth.md` section ("Customer token auto-refresh (opt-in)").
- **Changeset:** `minor` on **both** packages (additive opt-in feature).

## Out of scope

- Proactive/scheduled refresh.
- `requestRaw` auto-refresh.
- Persisting `saasToken`.
- Any change to the default (off) behavior.
