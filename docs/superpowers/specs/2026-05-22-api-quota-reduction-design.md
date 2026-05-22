# API-Quota Reduction in React Hooks — Design

**Status:** Approved (2026-05-22)
**Scope:** `@viu/emporix-sdk-react` only — no SDK change.
**Breaking?** No public API removed. Consumers passing their own `queryClient` keep their existing defaults.

## Problem

Emporix enforces an API-call quota at the tenant level. The current React-hook layer uses React-Query's stock defaults, which fire many calls that don't move the UX needle:

| Default | Effect |
|---|---|
| `staleTime: 0` | Every component mount + remount triggers a refetch even on cache hit. |
| `refetchOnWindowFocus: true` | Switching browser tabs and back refetches every active query. |
| `refetchOnMount: true` | Mounting a component with an existing cache entry still refetches. |
| `refetchOnReconnect: true` | Network blips refetch every query. |
| `retry: 3` | Failed requests fire **4× total** (1 + 3 retries). |
| `gcTime: 5 min` | Cache evicts after 5 min idle; navigating back forces a refetch. |

On top of that, three hook paths bypass React-Query entirely, missing deduplication:

1. **`useActiveCart({ create: true })` bootstrap** — calls `client.carts.getCurrent({create:true})` directly in a `useEffect`. Two parallel mounts (header mini-cart + cart page) fire two `getCurrent` calls.
2. **`useCustomerSession.login` cart onboarding** — calls `client.carts.getCurrent({create:true})` directly. If a cart-page is mounted with `useActiveCart({create:true})` at login time, the onboarding race fires the call twice.
3. **`honourPreferredSite` after login** — calls `client.customers.me()` directly **alongside** the `meQuery` refetch triggered by the post-login `invalidateQueries`, producing two `GET /customer/me` calls per login.

Typical browsing pattern (storefront with header mini-cart + catalog page + 2 tabs): tab-switch back fires three unnecessary calls (cart, products, sites). At 100 tab-switches per session, that's 300 wasted calls — measurable against quota.

## Goal

1. Set sane `QueryClient` defaults (Balanced profile) so refetches happen only when fresh data matters.
2. Add per-hook `staleTime` overrides for resources that change rarely (sites, payment modes, categories).
3. Route the three bypass paths through `qc.fetchQuery` so React-Query dedups concurrent calls and reuses cached results.
4. Reorder `useCustomerSession.login` so the explicit `me` fetch and the `meQuery` refetch share one cache entry.

## Non-Goals

- Cross-tab cart synchronization (Future scope).
- Speculative prefetching at navigation events.
- Server-side caching at the SDK level.
- Observability / metrics for cache hit-rate.
- Changing customer-facing UX expectations (e.g. Cart remains `staleTime: 0` for live editing).

## Target Architecture

### Layer 1: QueryClient default policy (Balanced profile)

When `EmporixProvider` falls back to a self-created QueryClient (no `queryClient` prop), it sets:

```ts
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
```

Effects:
- Tab-switch back: no refetches for queries < 30 s old.
- Failed query: max 2 calls (1 + 1 retry) instead of 4.
- Initial mount: refetch happens only after 30 s of staleness.

Consumers passing their own `queryClient` are unaffected — the provider only applies defaults when constructing its own client.

### Layer 2: Per-hook `staleTime` overrides

Each hook annotates its `useQuery` config with a `staleTime` that reflects "how fast does this resource change in a typical storefront session?":

| Hook(s) | staleTime | Rationale |
|---|---|---|
| `useSites`, `useDefaultSite`, `usePaymentModes` | **10 min** | Admin-configured; never changes mid-session. |
| `useCategory`, `useCategories(Infinite)`, `useCategoryTree`, `useProductsInCategory(Infinite)`, `useProductMedia`, `useMySegments`, `useMySegmentItems`, `useMySegmentCategoryTree`, `useMySegmentProducts(Infinite)`, `useMySegmentCategories(Infinite)` | **5 min** | Catalog structure and segment membership are slow-changing. |
| `useProducts(Infinite)`, `useProduct`, `useProductByCode`, `useMatchPrices` | **60 s** | Listings + prices can include promotions; refresh once per minute is enough. |
| `useProductSearch`, `useCustomerSession.meQuery`, `useCart`, `useActiveCart`, `useCartMutations`, `useCustomerAddresses` | **default (30 s)** | User-action-driven; mutations invalidate explicitly. |

Each hook accepts a `staleTime` field on its existing `options` to override. Aggressive-mode consumers can do `useProducts({}, { staleTime: 10 * 60_000 })`.

### Layer 3: Shared bootstrap cache for cart

A new internal helper, `packages/react/src/hooks/internal/bootstrap-cart.ts`, encapsulates the `client.carts.getCurrent({create:true})` call through `qc.fetchQuery`:

```ts
export async function bootstrapCart(opts: {
  qc: QueryClient;
  client: EmporixClient;
  ctx: AuthContext;
  authKind: string;
  siteCode: string;
  type?: string;
  legalEntityId?: string;
}): Promise<Cart | null> {
  return opts.qc.fetchQuery({
    queryKey: [
      "emporix",
      "cart-bootstrap",
      {
        tenant: opts.client.tenant,
        authKind: opts.authKind,
        siteCode: opts.siteCode,
        ...(opts.type !== undefined ? { type: opts.type } : {}),
        ...(opts.legalEntityId !== undefined ? { legalEntityId: opts.legalEntityId } : {}),
      },
    ],
    queryFn: () =>
      opts.client.carts.getCurrent(opts.ctx, {
        siteCode: opts.siteCode,
        ...(opts.type !== undefined ? { type: opts.type } : {}),
        ...(opts.legalEntityId !== undefined ? { legalEntityId: opts.legalEntityId } : {}),
        create: true,
      }),
    staleTime: Infinity,
  });
}
```

`staleTime: Infinity` is safe because:
- `useActiveCart`'s effect gates on `cartId !== null` — won't run bootstrap when storage already has one.
- Successful bootstrap writes `storage.setCartId` + local state; the cache entry is short-lived (`gcTime: 5min` default) and gets evicted naturally.
- Logout/discard paths clear `storage.cartId` AND `qc.removeQueries(["emporix"])`, dropping the cache entry.

Both call sites switch to it:
- `useActiveCart` effect → `await bootstrapCart({...})` → write storage + state.
- `useCustomerSession.onboardCustomerCart` → same helper, customer-auth context.

Concurrent mounts (header mini-cart + cart page) or concurrent login+mount fire **one** server call; subsequent calls within `gcTime` return the cached cart.

### Layer 4: Login-path `/customer/me` dedup

`useCustomerSession.meQuery` uses key `["emporix","customer","me", { tenant, hasToken }]`. `honourPreferredSite` now uses the same key via `qc.fetchQuery`:

```ts
async function honourPreferredSite(opts: {
  qc: QueryClient;
  client: EmporixClient;
  customerToken: string;
  siteCtx: SiteContextValue | null;
}): Promise<void> {
  if (!opts.siteCtx) return;
  try {
    const me = await opts.qc.fetchQuery({
      queryKey: [
        "emporix",
        "customer",
        "me",
        { tenant: opts.client.tenant, hasToken: true },
      ],
      queryFn: () =>
        opts.client.customers.me(auth.customer(opts.customerToken)),
    });
    const preferred = (me as { preferredSite?: string }).preferredSite;
    if (preferred && opts.siteCtx.siteCode !== preferred) {
      await opts.siteCtx.setSite(preferred);
    }
  } catch {
    // Best-effort — never block login on a preference lookup.
  }
}
```

The **call-order in `login`** changes so `honourPreferredSite` runs BEFORE `invalidateQueries`:

```
1. client.customers.login()                            ← 1 call (login itself)
2. storage.setCustomerToken + setToken
3. bootstrapCart (customer auth)                       ← 1 call /cart/.../carts
4. honourPreferredSite (writes meQuery cache)          ← 1 call /customer/me
5. invalidateQueries(["emporix","customer"])           ← marks meQuery stale, but no auto-refetch
6. invalidateQueries(["emporix","cart"])
```

**Why no auto-refetch at step 5?** The `meQuery` has `staleTime: 30_000` (the new default). Step 4 just wrote fresh data into the cache, so `invalidateQueries` marks it stale but doesn't force a refetch until a component remounts past the staleness window. Net result: **one** `GET /customer/me` per login.

## Data Flow

### Tab-switch back to storefront

```
Browser focus event
  ├─ refetchOnWindowFocus is now false → no refetches
  └─ User browses; staleTime gates apply on next intentional refetch
```

### Header mini-cart + cart page both mounted, no cart in storage

```
Mount header (useActiveCart, no create)               → idle, data === null
Mount cart page (useActiveCart({ create: true }))     → bootstrapCart fired
  → qc.fetchQuery sees no entry under cart-bootstrap key
  → fires GET /cart/{tenant}/carts → cart C1
  → storage.setCartId(C1) + setState
Header re-renders → useCart(C1) → fetch /carts/C1 (separate key)
                  → cache miss → GET /carts/C1 (1 call)
Cart-page re-renders → useCart(C1) → same key → cache hit, no new call

Total: 2 calls (1 bootstrap + 1 cart-by-id).
```

### Customer login (with preferredSite "Y", active site "X")

```
1. POST /customer/login                                ← 1 call
2. storage.setCustomerToken + setToken
3. bootstrapCart with customer auth
   → qc.fetchQuery cart-bootstrap key (cust auth)
   → GET /cart/{tenant}/carts                          ← 1 call
   → storage.setCartId + merge anon cart (if any)
4. honourPreferredSite
   → qc.fetchQuery meQuery key (customer auth)
   → GET /customer/me                                  ← 1 call
   → preferredSite "Y" detected, setSite("Y")
   → setSite fetches site DTO + PATCH                  ← 2 calls (GET site + PATCH session-context, both already cached/expected)
5. invalidateQueries cart/customer (no auto-refetch, fresh cache)

Total minimal: 5 calls (vs current 7+).
```

## Edge Cases

| Scenario | Behavior |
|---|---|
| Consumer passes own `queryClient` to `EmporixProvider` | No defaults applied — consumer keeps full control. Doc note: for full quota effect, omit the prop or apply the same defaults. |
| Multiple `useActiveCart({create:true})` instances mount in different tabs | Each tab has its own `QueryClient` → dedup only works per-tab. Cross-tab dedup is out of scope. |
| Anonymous → customer login race | `authKind` is part of the bootstrap-cart cache key → anon and customer entries are separate. The login flow's `qc.invalidateQueries(["emporix"])` (via `setSite` or cart-onboarding) clears stale anon entries. |
| Bootstrap returns an error | `qc.fetchQuery` rejects; both `useActiveCart` effect and `onboardCustomerCart` catch and ignore (best-effort, matches existing behavior). |
| `useCustomerSession` mounted without a `SiteContextProvider` ancestor (legacy test setup) | `siteCtx === null` → `honourPreferredSite` early-returns, no behavior change. |
| `useMatchPrices` consumer wants always-fresh prices | Pass `staleTime: 0` via the existing `options`. Default 60 s keeps Repeated calls cheap. |

## Implementation Sketches

### `EmporixProvider` QueryClient defaults

```ts
const DEFAULT_QUERY_OPTIONS = {
  staleTime: 30_000,
  refetchOnWindowFocus: false,
  retry: 1,
} as const;

const qc = useMemo(
  () =>
    queryClient ??
    new QueryClient({ defaultOptions: { queries: DEFAULT_QUERY_OPTIONS } }),
  [queryClient],
);
```

### `useActiveCart` effect, refactored

```ts
useEffect(() => {
  if (cartId !== null) return;
  if (!opts?.create) return;
  const siteCode = activeSite ?? client.config?.credentials?.storefront?.context?.siteCode;
  if (!siteCode) return;
  let cancelled = false;
  bootstrapCart({
    qc,
    client,
    ctx,
    authKind: kind,
    siteCode,
    ...(opts.type !== undefined ? { type: opts.type } : {}),
    ...(opts.legalEntityId !== undefined ? { legalEntityId: opts.legalEntityId } : {}),
  })
    .then((cart) => {
      if (cancelled || !cart?.id) return;
      storage.setCartId(cart.id);
      setCartId(cart.id);
    })
    .catch(() => {});
  return () => {
    cancelled = true;
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [cartId, opts?.create, opts?.type, opts?.legalEntityId, kind, activeSite]);
```

The hook gains a `useQueryClient()` call at the top of the function body.

### `useCustomerSession.login` order

```ts
const login = useCallback(
  async (input) => {
    const session = await client.customers.login(input);
    storage.setCustomerToken(session.customerToken);
    setToken(session.customerToken);
    setRefreshTok(session.refreshToken || null);
    setSaasTok(session.saasToken || null);
    await onboardCustomerCart({ qc, client, storage, customerToken: session.customerToken });
    // Honour preferred site BEFORE invalidate — writes meQuery cache.
    await honourPreferredSite({
      qc,
      client,
      customerToken: session.customerToken,
      siteCtx,
    });
    await qc.invalidateQueries({ queryKey: ["emporix", "customer"] });
    await qc.invalidateQueries({ queryKey: ["emporix", "cart"] });
  },
  [client, storage, qc, siteCtx],
);
```

`applySession` mirrors the same order.

## Test Plan

All tests added to existing files; one new file for QueryClient defaults.

| Test | File | Verifies |
|---|---|---|
| QueryClient default `staleTime`, `refetchOnWindowFocus`, `retry` are applied when no prop passed | `tests/provider.test.tsx` (new) | Inspects `qc.getDefaultOptions().queries` after Provider mount |
| External `queryClient` prop bypasses default-injection | `tests/provider.test.tsx` (new) | Consumer-passed defaults survive unchanged |
| Two parallel `useActiveCart({ create: true })` mounts share one bootstrap call | `tests/use-active-cart.test.tsx` | MSW spy on `GET /cart/.../carts` counts 1 across 2 hooks |
| Login fires `GET /customer/me` exactly once when preferredSite is set | `tests/use-customer-session.test.tsx` | MSW spy counter = 1 (was 2) |
| `useSites` cache-hit within 10 min | `tests/use-sites.test.tsx` | Second render: server-call counter stays at 1 |
| `useMatchPrices` cache-hit within 60 s | `tests/use-match-prices.test.tsx` | Same pattern |
| `useCart` still refetches by default (staleTime 30s only protects within window) | `tests/use-cart.test.tsx` (existing tests) | Existing tests still green |
| Existing 289 tests pass unchanged | n/a | Build-time |

## Cross-cutting

### Storage

No changes. `storage.cartId` write semantics unchanged.

### SDK

No changes. All work is React-package internal.

### Documentation

Update `docs/react.md`:
1. Add a "Caching & quota" subsection under Provider, documenting the Balanced defaults and how to override per-call.
2. Update each hook's documentation paragraph to mention its `staleTime`.

### Changeset

```markdown
---
"@viu/emporix-sdk-react": minor
---

API-quota reduction: sane QueryClient defaults + bootstrap deduplication.

**QueryClient defaults** (only applied when no `queryClient` prop is passed):
- `staleTime: 30s` — fresh-within-30s policy reduces refetch-on-mount churn.
- `refetchOnWindowFocus: false` — tabbing back no longer refetches all queries.
- `retry: 1` — single retry on failure instead of three (caps failed-request
  cost at 2× per query).

**Per-hook staleTime overrides:**
- `useSites`, `useDefaultSite`, `usePaymentModes` — 10 min.
- `useCategory(ies)`, `useCategoryTree`, `useProductsInCategory(Infinite)`,
  `useProductMedia`, `useMySegment*` — 5 min.
- `useProducts(Infinite)`, `useProduct`, `useProductByCode`,
  `useMatchPrices` — 60 s.
- Cart, Profile, Search, Addresses keep the 30s default
  (or 0 where freshness matters).

**Bootstrap dedup:**
- `useActiveCart({ create: true })` and `useCustomerSession.login` cart
  onboarding share a single `qc.fetchQuery` cache entry — parallel mounts
  trigger one server call.
- `useCustomerSession.login` honours `customer.preferredSite` via the same
  `meQuery` cache key — login fires one `GET /customer/me` instead of two.

No breaking changes. Consumers passing their own `queryClient` to
`EmporixProvider` keep their existing defaults.
```

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `refetchOnWindowFocus: false` hides stale cart state when user has multiple tabs | Cart hooks keep short `staleTime`; cross-tab sync is future scope |
| 10-min `staleTime` for sites/payment-modes hides admin changes mid-session | Acceptable — admin changes typically require page reload anyway |
| Consumers with custom `queryClient` see no quota improvement | Doc note: for full effect, omit the prop or apply the same defaults |
| Bootstrap-cart `staleTime: Infinity` could leak stale Cart data if Emporix server-side reassigns the cart | `gcTime: 5 min` default evicts entry naturally; logout/discard explicitly `removeQueries(["emporix"])` |
| Login-path reordering breaks an existing test that asserts `invalidateQueries` runs before any `customers.me` call | Tests use MSW counters, not call ordering; rerun suite |

## Out of Scope (Follow-ups)

- Cross-tab sync (broadcast cart-id / customer-token changes via `BroadcastChannel`).
- Request batching for catalog reads (the SDK could combine multiple `useProduct(id)` mounts into a `searchByIds` call, but that's a bigger refactor with API-shape consequences).
- Observability: emit cache-hit/miss metrics via the logger so consumers can quantify quota savings in production.
- A "Quota mode" preset that flips all hooks to even longer staleTimes (currently consumer can set per-hook).
