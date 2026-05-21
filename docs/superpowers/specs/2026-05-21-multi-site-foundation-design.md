# Multi-Site Foundation — Design

**Status:** Draft (2026-05-21)
**Scope:** `@viu/emporix-sdk` + `@viu/emporix-sdk-react`
**Breaking?** No public API removed. Internal cache-keys gain a `siteCode` component (transparent to consumers).
**Stages:** MS-1 → MS-2 → MS-3 → MS-4, ship-able independently.

## Problem

Today the SDK binds the storefront's **site context** statically at client construction:

```ts
new EmporixClient({
  tenant: "viu",
  credentials: {
    storefront: {
      clientId: "…",
      context: { currency: "CHF", siteCode: "main", targetLocation: "CH" },
    },
  },
});
```

This works for tenants with one active site, but breaks down for the Emporix multi-site model where a tenant may run multiple sites (e.g. `ThermoBrand_DE` + `WarmTech_DE`, or `CH` + `DE` + `NL`). Each site has its own currency, catalog, availability, pricing, segments, and carts. To a storefront, sites are a **runtime concern** — the user picks a brand/country, and the entire catalog/cart/price view must rebind.

Concrete gaps in today's SDK:
1. `siteCode` is static and not observable — components can't react to changes.
2. No way to switch sites at runtime without recreating the `EmporixClient`.
3. No `Sites` service binding (`/site/{tenant}/sites`) — apps hardcode site lists.
4. No session-context PATCH binding (`/session-context/{tenant}/me/context`) — server stays on old site after a client-side switch.
5. Cache keys (`useProducts`, `useCategories`, `useCart`, `useActiveCart`, `useCartMutations`, `useProductsInCategory`) do **not** include `siteCode` — cache cross-contamination on switch.
6. `currency` doesn't auto-derive from the active site.
7. Customer's `customerprefferedSite` is ignored at login.

## Goal

Make site a **first-class runtime concept** in both packages:

1. (MS-1) Add a `client.sites` service and a `useSites()` Read-Hook.
2. (MS-2) Make the active `siteCode` observable provider-state with a `useSiteContext()` hook; bake `siteCode` into every site-aware query key.
3. (MS-3) Bind `/session-context/{tenant}/me/context` and provide a `setSite(code)` mutation that syncs server-side session state.
4. (MS-4) Auto-derive `currency` from the active site's DTO and honour `customer.customerprefferedSite` at login.

## Non-Goals

- Multi-client-per-site (Option B from the earlier analysis). YAGNI — the runtime-switch pattern covers it.
- Server-Components helpers for site context (`prefetchSites`, etc.). Add when a concrete SSR consumer surfaces.
- Custom `restriction` values beyond `siteCode` (B2B legal-entity / regional groupings). Site-Permissions feature is server-side; SDK consumers can pass `legalEntityId` already where supported.
- Migration of `useMySegment*` hooks' per-call `siteCode` parameter (they keep their explicit option for backwards compatibility — Provider state becomes the **default**).

## Glossary (per Emporix docs)

| Term | Definition |
|---|---|
| **Site** | A country/brand combo (`Netherlands`, `ThermoBrand_DE`). Each has currency, default language, ship-to-countries, payment/shipping config. |
| **Catalog** | Site-aware container of categories. `publishedSites: string[]` decides where it appears. |
| **Availability** | Per-`(productId, siteCode)` record. Without it, a product is invisible on that site. |
| **Price.restrictions.siteCodes** | Limits a price to specific sites. |
| **Segment.siteCode** | A segment is site-scoped — `Wholesaler` on `ThermoBrand_DE` ≠ same on `WarmTech_DE`. |
| **Cart uniqueness** | `(siteCode, type, legalEntityId, sessionId\|customerId)`. Same customer can have one cart per site. |
| **Customer.customerprefferedSite** | Customer-profile attribute the server falls back to when no site is in the session-context. |
| **Session-Context** | Server-side per-session document holding `{ siteCode, currency, targetLocation, language, cartId, customerId }`. PATCH-able via `/session-context/{tenant}/me/context`. |

## Target Architecture (overview)

```
EmporixProvider
  ├─ client (EmporixClient — once per app/server)
  ├─ storage (EmporixStorage — persists emporix.cartId, emporix.customerToken,
  │           emporix.anonymousSession, NEW: emporix.siteCode)
  └─ siteContext (NEW provider state, MS-2+)
       ├─ siteCode: string | null
       ├─ currency: string | null    (derived in MS-4)
       ├─ targetLocation: string | null
       └─ setSite(code): Promise<void>  (calls sessionContext.patch in MS-3)

EmporixClient
  ├─ products, categories, carts, checkout, customers, … (existing)
  ├─ sites (NEW MS-1) — list / get / listMine / current
  └─ sessionContext (NEW MS-3) — patch

React-Query cache keys (MS-2):
  ["emporix", <resource>, …, { tenant, authKind, siteCode }]
                                                 ↑ NEW component
```

The active `siteCode` flows: storage → provider-state on mount → every site-aware query key → service-call URL params. On `setSite(code)`:
1. `qc.invalidateQueries(["emporix"])` — drop everything site-keyed.
2. `client.sessionContext.patch({ siteCode, currency, targetLocation, version })` — server in sync.
3. `storage.setSiteCode(code)` + `setSiteCodeState(code)` — local in sync.
4. Optionally: clear `emporix.cartId` (carts are site-aware — old cart belongs to old site).

---

## Stage MS-1: `client.sites` service + `useSites()` Read-Hook

**SDK additions** (`@viu/emporix-sdk`):

```ts
export interface Site {
  code: string;
  name: string;
  active: boolean;
  default: boolean;
  defaultLanguage: string;
  languages: string[];
  currency: string;
  availableCurrencies?: string[];
  homeBase: { address: { country: string; zipCode: string; /* … */ } };
  shipToCountries: string[];
  // (additional fields from SiteDto schema, mapped 1:1)
}

class SiteService {
  /** Lists active sites visible to the storefront context. */
  list(auth?: AuthContext): Promise<Site[]>;
  /** Retrieves one site by code. */
  get(code: string, auth?: AuthContext): Promise<Site>;
  /** Returns the tenant's default site (the one with `default: true`). */
  current(auth?: AuthContext): Promise<Site>;
}
```

Endpoint mapping:
- `list` → `GET /site/{tenant}/sites` (active sites only; `site_manage` not required)
- `get` → `GET /site/{tenant}/sites/{siteCode}`
- `current` → derives from `list()` filtered to `default: true`; no dedicated endpoint

`auth` defaults to `anonymous()` (sites are public storefront data).

**React additions** (`@viu/emporix-sdk-react`):

```ts
/** Lists active sites for the tenant. Disabled until provider is mounted. */
export function useSites(options?: QueryOpts): UseQueryResult<Site[]>;
/** Convenience: the default site. */
export function useDefaultSite(options?: QueryOpts): UseQueryResult<Site>;
```

Cache keys: `["emporix", "sites", { tenant, authKind }]` and `["emporix", "site-default", …]`. **Not yet site-keyed** — these list/identify sites, they're not site-scoped data.

**Test plan (MS-1):**
- SDK: `list()` returns 2 sites (MSW); `get("ThermoBrand_DE")` returns the right one; `current()` returns the `default: true` site; error propagation on 404/403.
- React: `useSites()` resolves to the array; `useDefaultSite()` returns the default-flagged entry; both cache under tenant+authKind.

**Migration:** none — additive.

---

## Stage MS-2: Observable provider-state + cache-key migration

### Provider API change (additive)

```tsx
<EmporixProvider
  client={client}
  storage={storage}
  initialSiteCode={"ThermoBrand_DE"}   // optional; falls back to client.config.…context.siteCode
>
  <App />
</EmporixProvider>
```

The provider exposes site context via:

```ts
interface SiteContextValue {
  siteCode: string | null;
  currency: string | null;       // populated in MS-4
  targetLocation: string | null; // populated in MS-4
  /** Updates local state + storage. Becomes a Promise in MS-3 (adds sessionContext.patch). */
  setSite: (code: string) => void;
}

export function useSiteContext(): SiteContextValue;
```

Initial-state resolution order:
1. `<EmporixProvider initialSiteCode="…">` prop, if passed.
2. `storage.getSiteCode()` (persisted from last session — `emporix.siteCode`).
3. `client.config.credentials.storefront.context.siteCode` (static config).
4. `null` (no site bound).

### Storage extension

```ts
interface EmporixStorage {
  getCustomerToken / setCustomerToken
  getCartId / setCartId
  getAnonymousSession / setAnonymousSession
  // NEW MS-2:
  getSiteCode(): string | null;
  setSiteCode(code: string | null): void;
}
```

All three storage backends (`memory`, `localStorage`, `cookie`) get the new methods. Storage key: `emporix.siteCode`. Default storage adapter (`createMemoryStorage`) reads/writes it in-memory.

### Cache-key migration (transparent to consumers)

Every site-aware Read-Hook prepends `siteCode` (or `null`) to its query key's last meta-object:

```ts
// before
queryKey: ["emporix", "products", params, { tenant, authKind }]
// after
queryKey: ["emporix", "products", params, { tenant, authKind, siteCode }]
```

Affected hooks:
| Hook | Site-aware? |
|---|---|
| `useProducts`, `useProductsInfinite`, `useProductByCode`, `useProductSearch` | yes (availability+price-restrictions filter server-side per session-context) |
| `useCategory`, `useCategories`, `useCategoriesInfinite`, `useCategoryTree`, `useProductsInCategory`, `useProductsInCategoryInfinite` | yes (catalog→publishedSites) |
| `useCart`, `useActiveCart`, `useCart(cartId)`, `useCartMutations` | yes (cart uniqueness includes siteCode) |
| `useMatchPrices` | yes (matchByContext reads session-context) |
| `useMySegments`, `useMySegmentItems`, `useMySegmentCategoryTree`, `useMySegmentProducts(Infinite)`, `useMySegmentCategories(Infinite)` | yes (segment is site-scoped) |
| `useProductMedia` | no — media is product-scoped, not site-scoped |
| `useCustomerSession`, `useCustomer*` | no — customer is tenant-scoped |
| `usePaymentModes` | yes — payment configs are per-site |
| `useCheckout` | no — site is per-mutation already |

Hooks **without** site-awareness skip the cache-key change.

### Internal hook refactor

A small helper in `packages/react/src/hooks/internal/use-site-context.ts` reads from `useSiteContext()` and exposes both the value and a `keySite` (`siteCode` or `null`) for query-key composition:

```ts
function useReadSite(): { siteCode: string | null; keySite: string | null };
```

Hooks compose like:
```ts
const { ctx, kind } = useReadAuth(options.auth);
const { keySite } = useReadSite();
return useQuery({
  queryKey: ["emporix", "products", params, { tenant: client.tenant, authKind: kind, siteCode: keySite }],
  queryFn: () => client.products.list(params, ctx),
});
```

**Open behavior — does `setSite` clear the active cart?**
Carts are site-aware (uniqueness includes `siteCode`). After `setSite(newCode)`, the cart-id in storage refers to a cart bound to the **old** site — invisible on the new site. The provider clears `storage.setCartId(null)` on every `setSite` call. Consumers who need cross-site cart logic can pass `{ keepCart: true }` later (MS-3 follow-up, out of scope here).

**Test plan (MS-2):**
- Storage: `setSiteCode`/`getSiteCode` for all three backends + persistence on reload (localStorage spec).
- Provider: `initialSiteCode` prop wins over storage; storage wins over client config; both absent → `null`.
- `useSiteContext()`: state reflects provider; `setSite("X")` updates state + storage + clears `emporix.cartId`.
- Cache-key: 2 `useProducts` instances under different sites yield 2 cache entries; same site → 1 entry.
- Migration: existing tests still green (they ran with no provider site context = `siteCode: null` key — same as before).

**Migration impact:** every existing `queryKey` shape changes. Internal-only — no consumer subscribes to keys directly. Tests need updating (~30 assertions on key shape).

---

## Stage MS-3: `client.sessionContext.patch` + async `setSite`

### SDK addition

```ts
export interface SessionContextPatch {
  siteCode?: string;
  currency?: string;
  targetLocation?: string;
  language?: string;
  context?: Record<string, unknown>;
}

class SessionContextService {
  /**
   * Partially updates the current session's context.
   * Requires a current `metadata.version` (optimistic locking) — fetched
   * lazily via GET first if not provided by the caller.
   */
  patch(input: SessionContextPatch, auth?: AuthContext): Promise<void>;
  /** Retrieves the current session context. */
  get(auth?: AuthContext): Promise<SessionContext>;
}
```

Endpoint: `PATCH /session-context/{tenant}/me/context`. Auth: customer or anonymous (both work — the session-context resolves from the `Authorization` token's session-id).

Optimistic-locking handling: the SDK fetches the current context's `metadata.version` immediately before PATCH (one extra GET) — keeps the public API a single call. Consumers who want manual control can use `get()` + `patch({...input, version})` directly.

### React hook becomes a Promise

```ts
// MS-2:
setSite: (code: string) => void;
// MS-3:
setSite: (code: string) => Promise<void>;
```

New `setSite(code)` flow:
1. `await qc.cancelQueries(["emporix"])` — block in-flight requests
2. `storage.setSiteCode(code)` + local state update
3. `storage.setCartId(null)` — site-aware cart invalidation (see MS-2 note)
4. `await qc.invalidateQueries(["emporix"])` — refetch all site-keyed queries on the new site
5. `await client.sessionContext.patch({ siteCode: code }, auth)` — server in sync
6. On step-5 failure: state stays optimistic (UI already on new site); error surfaces via a `setSiteError` field on the context

Why optimistic? Storefront UX expects instant feedback. If the PATCH later fails (rare — e.g. network), the UI shows an error banner; the next user interaction can retry. We don't roll back state because the caches already invalidated.

**`useSiteContext` API surface adds:**
```ts
{
  siteCode, currency, targetLocation,
  setSite: (code: string) => Promise<void>,
  // NEW MS-3:
  isSwitching: boolean;
  switchError: Error | null;
}
```

**Test plan (MS-3):**
- SDK: `patch({siteCode})` does GET (version fetch) + PATCH; passes `metadata.version` correctly; 409 conflict surfaces as `EmporixError`.
- React: `setSite("X")` invalidates cart-id, invalidates queries, calls `patch`; `isSwitching` toggles; `switchError` populated on PATCH-fail; no state rollback on error.

---

## Stage MS-4: Currency auto-derive + `customerprefferedSite` at login

### Currency derivation

When `setSite(code)` is called (MS-3), the provider also resolves the new site's `currency` and `targetLocation`:

```ts
async setSite(code) {
  const site = await qc.fetchQuery({
    queryKey: ["emporix", "sites", "by-code", code, { tenant, authKind }],
    queryFn: () => client.sites.get(code, ctx),
    staleTime: 5 * 60_000, // Site metadata changes rarely.
  });
  // ... existing flow
  setCurrency(site.currency);
  setTargetLocation(site.homeBase.address.country);
  await client.sessionContext.patch({
    siteCode: code,
    currency: site.currency,
    targetLocation: site.homeBase.address.country,
  });
}
```

The initial provider mount also fetches the active site's DTO (if a `siteCode` was resolved from storage or initial prop) to populate `currency`/`targetLocation`. Until that fetch completes, `currency` and `targetLocation` remain `null` and `useSiteContext()` exposes `isResolving: true`.

### Customer-preference honouring at login

`useCustomerSession.login` already runs cart-onboarding (PR #26). MS-4 extends the post-login flow:

1. Fetch customer profile (already happens — `useCustomerSession.customer`).
2. If `customer.customerprefferedSite` is set AND differs from `useSiteContext().siteCode`:
   - Log info: "Switching to customer's preferred site `<code>`."
   - Call `setSite(customerprefferedSite)` — same flow as user-driven switch.
3. Otherwise: leave the current site as-is (anonymous browse choice persists).

Behavioural choice: customer preference **overrides** the anonymous browse session. Rationale: the customer's stored preference is the source-of-truth for "their" site; anonymous picks are exploratory. If product wants the opposite, it's a one-line flag we can add later.

**Test plan (MS-4):**
- Provider: on mount with `initialSiteCode="X"`, after first `useSites.get("X")` resolves, `currency` populates.
- `setSite`: fetches site DTO, updates `currency`/`targetLocation`, includes them in `patch()` call.
- Login: customer with `customerprefferedSite: "Y"` and provider on `"X"` → switches to `"Y"`.
- Login: customer without `customerprefferedSite` → site stays as-is.

---

## Cross-cutting concerns

### Storage migration

`emporix.siteCode` is a new key. Existing storages without it return `null` from `getSiteCode()` — backward-compatible. Persistence behaviour matches `emporix.cartId`:

| Backend | Persistence |
|---|---|
| `createMemoryStorage` | in-memory only; lost on reload |
| `createLocalStorageStorage` | persists; survives reload |
| `createCookieStorage` | persists; subject to caller-set `sameSite`/`secure`/`maxAge` |

### Test-suite size estimate

| Stage | New tests (rough) |
|---|---|
| MS-1 | 8 (SDK service + React hook) |
| MS-2 | 18 (storage, provider, useSiteContext, cache-key shape) |
| MS-3 | 10 (sessionContext.patch + setSite full flow) |
| MS-4 | 6 (currency derivation + login-pref switch) |
| **Total** | **~42 tests** |

### Existing test impact

| Stage | Existing tests requiring update |
|---|---|
| MS-1 | 0 |
| MS-2 | ~30 assertions on `queryKey` shape (all internal — no public-API breakage) |
| MS-3 | 0 (setSite is new) |
| MS-4 | 2-3 customer-session login tests gain a "no preferred site" assertion |

### Changeset

```markdown
---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Multi-site foundation: site context becomes a first-class runtime concept.

- `client.sites.list/get/current` — Site Settings Service binding (MS-1).
- `useSites()`, `useDefaultSite()` — React hooks for site discovery (MS-1).
- `<EmporixProvider initialSiteCode>` + `useSiteContext()` — observable
  active siteCode with `setSite(code)` action (MS-2).
- `EmporixStorage.{get,set}SiteCode` — persistence across reloads (MS-2).
- `client.sessionContext.patch/get` — server-side session-context sync (MS-3).
- `setSite()` becomes async, calls `sessionContext.patch`, clears site-
  aware caches + storage cartId (MS-3).
- Active site's `currency` + `targetLocation` auto-derive from the site
  DTO; customer's `customerprefferedSite` honored at login (MS-4).

All hook query-keys gain a `siteCode` component — same site = same cache,
different site = separate cache. No public API removed; existing call
signatures continue to work.
```

---

## Migration / Compatibility

For consumers running **today's** SDK with a single static `siteCode`:
1. Upgrade — no code change required. The static-config `siteCode` becomes the `useSiteContext()` initial value.
2. To opt into the runtime-switch, wrap with `<EmporixProvider initialSiteCode>` (or omit — static config still works).
3. Old query-cache entries from before the upgrade are dropped on next deploy (different key shape). Acceptable since users see a forced refetch, not a broken state.

## Open Questions

These are decisions locked in this spec; recording them so future readers don't second-guess:

1. **Optimistic local state on `setSite` failure?** YES — UI flips instantly; PATCH failure surfaces via `switchError`. Rationale: storefront UX expects no flicker on common-path.
2. **Clear cartId on `setSite`?** YES — carts are site-aware; old cart-id is unreachable on new site. Bootstrap-new on next render.
3. **Customer preferredSite overrides anonymous browse?** YES at login (MS-4). One-line flip if product wants the opposite.
4. **Site listing requires backend auth?** NO — `site_read` scope is the default for active sites; anonymous storefront context satisfies it.
5. **Auto-fetch Site DTO on every mount?** Only when a `siteCode` is bound. `staleTime: 5min` — site metadata changes rarely.

## Out of Scope (Follow-ups)

- `prefetchSites` / `prefetchSiteContext` for SSR.
- B2B legal-entity context as a first-class runtime concept (parallel to site).
- Per-customer site-permissions enforcement on the client (server handles it; client only needs `restriction` field awareness if a future feature surfaces).
- Site-switcher UI in `examples/vite-spa` + `examples/next-app-router`. Likely follow-up after MS-2 lands.
