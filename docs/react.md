# React integration

`@viu/emporix-sdk-react` wraps the core SDK with `@tanstack/react-query` v5.
The core SDK has **no** React dependency; React lives only in this package.

## Provider

```tsx
<EmporixProvider
  client={client}
  queryClient={qc?}
  storage={storage?}
  initialCustomerToken={token?}
  initialSiteCode={siteCode?}
  initialActiveLegalEntityId={legalEntityId?}
>
  <App />
</EmporixProvider>
```

`useEmporix()` returns `{ client, storage }` and throws outside a provider.
`EmporixClient` must be created **once** — once per app (CSR) or once per server
(SSR), never per request/render.

## Storage adapters

| Adapter | Persistence | Notes |
| --- | --- | --- |
| `createMemoryStorage` (default) | none | SSR-safe; lost on reload |
| `createLocalStorage` (was `createLocalStorageStorage`) | `localStorage` | browser only; persistent and shared across tabs; falls back to memory + warns on the server |
| `createSessionStorage` | `sessionStorage` | browser only; per-tab — survives reload, cleared on tab close, not shared across tabs; falls back to memory + warns on the server |
| `createCookieStorage` | cookie | you must set `sameSite`/`secure`; readable by JS unless you manage an httpOnly cookie server-side |

Storage choices have security implications (XSS for `localStorage`, CSRF for
cookies) the SDK cannot make for you — hence opt-in, never automatic.

Each adapter persists six pieces under predictable keys:

- `emporix.customerToken` — string, set by `useCustomerSession.login/logout`.
- `emporix.cartId` — string, set by `useCreateCart`, cleared by the consumer.
- `emporix.anonymousSession` — JSON `{ refreshToken, sessionId }`, set by the
  SDK on every anonymous login/refresh. See [Persistent guest cart](#persistent-guest-cart).
- `emporix.siteCode` — string, set by `useSiteContext.setSite` (multi-site).
- `emporix.activeLegalEntityId` — string, set by `useActiveCompany.setActiveCompany` (B2B).
- `emporix.refreshToken` — string, mirrored from the customer session by
  `useCustomerSession` on every login/refresh. Required for B2B
  refresh-on-switch; cleared on logout.

### Writing a custom storage adapter

A storage backend is any object implementing the `EmporixStorage` interface
(`packages/react/src/storage/index.ts`); pass your instance to
`<EmporixProvider storage={…}>`. The three built-ins are the canonical templates —
`memory.ts` is the simplest: copy it and swap the backing store.

The contract is six `get*`/`set*` pairs (one per key above), plus two **optional**
subscription hooks:

| Hook | Purpose | Skip it? |
| --- | --- | --- |
| `subscribe(listener)` | Fires on **customer-token** change. Drives the shared `useCustomerSession` store (`useSyncExternalStore`) so login/logout/refresh re-render every consumer. | Omit only if you don't need reactive auth — components then won't see token changes until their next render. |
| `subscribeAll(listener)` | Fires the **changed key** (`EmporixStorageKey`). Telemetry only (`storage.write` events). | Safe to omit. |

`null` always means "absent". `get/setAnonymousSession` round-trip a
`PersistedAnonymousSession` (`{ refreshToken, sessionId }`). Two helpers are exported
from `./storage/index` for reuse: `createListenerSet()` (swallow-on-throw fan-out) and
`parseAnonymousSession()` (safe JSON parse).

#### Minimal skeleton

```ts
import type { EmporixStorage } from "@viu/emporix-sdk-react";

export function createMyStorage(): EmporixStorage {
  // back these by whatever you like (signal, IndexedDB, RN AsyncStorage, …)
  return {
    getCustomerToken: () => null,
    setCustomerToken: (t) => {},
    getCartId: () => null,
    setCartId: (id) => {},
    getAnonymousSession: () => null,
    setAnonymousSession: (s) => {},
    getSiteCode: () => null,
    setSiteCode: (c) => {},
    getActiveLegalEntityId: () => null,
    setActiveLegalEntityId: (id) => {},
    getRefreshToken: () => null,
    setRefreshToken: (t) => {},
    // optional: subscribe(listener) / subscribeAll(listener)
  };
}
```

#### Example: a Zustand-backed adapter

Zustand is itself a subscribable store, so it maps onto `EmporixStorage` directly —
and because it is *your* store too, your components read the same session state
reactively. Install `zustand`, then:

```ts
// session-store.ts
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { EmporixStorage, PersistedAnonymousSession } from "@viu/emporix-sdk-react";

interface SessionState {
  customerToken: string | null;
  cartId: string | null;
  anonymousSession: PersistedAnonymousSession | null;
  siteCode: string | null;
  activeLegalEntityId: string | null;
  refreshToken: string | null;
}

// Exported → components read reactively: useSessionStore((s) => s.customerToken)
export const useSessionStore = create<SessionState>()(
  persist(
    () => ({
      customerToken: null,
      cartId: null,
      anonymousSession: null,
      siteCode: null,
      activeLegalEntityId: null,
      refreshToken: null,
    }),
    {
      name: "emporix.session",
      // SSR-safe: no localStorage on the server
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? window.localStorage : undefined,
      ),
    },
  ),
);

export function createZustandStorage(): EmporixStorage {
  const s = useSessionStore; // StoreApi: getState / setState / subscribe
  return {
    getCustomerToken: () => s.getState().customerToken,
    setCustomerToken: (t) => s.setState({ customerToken: t }),
    // store.subscribe catches every token change (incl. app writes + rehydration)
    subscribe: (l) =>
      s.subscribe((st, prev) => {
        if (st.customerToken !== prev.customerToken) l(st.customerToken);
      }),

    getCartId: () => s.getState().cartId,
    setCartId: (id) => s.setState({ cartId: id }),
    getAnonymousSession: () => s.getState().anonymousSession,
    setAnonymousSession: (a) => s.setState({ anonymousSession: a }),
    getSiteCode: () => s.getState().siteCode,
    setSiteCode: (c) => s.setState({ siteCode: c }),
    getActiveLegalEntityId: () => s.getState().activeLegalEntityId,
    setActiveLegalEntityId: (id) => s.setState({ activeLegalEntityId: id }),
    getRefreshToken: () => s.getState().refreshToken,
    setRefreshToken: (t) => s.setState({ refreshToken: t }),

    // optional: emit the changed key for telemetry
    subscribeAll: (listener) => {
      const KEYS = [
        "customerToken", "cartId", "siteCode",
        "anonymousSession", "activeLegalEntityId", "refreshToken",
      ] as const;
      return s.subscribe((st, prev) => {
        for (const k of KEYS) if (st[k] !== prev[k]) listener(k);
      });
    },
  };
}
```

```tsx
<EmporixProvider client={client} storage={createZustandStorage()}>…</EmporixProvider>
```

#### Behaviour with Zustand

- **Identical to the built-ins from the SDK's side.** The SDK only calls the
  `EmporixStorage` methods; it never imports Zustand. Login/logout/refresh call
  `setCustomerToken` → `setState` → `subscribe` fires → the `useCustomerSession` store
  re-renders consumers, exactly like `createLocalStorageStorage`.
- **Single source of truth, bidirectional.** Wiring `subscribe` to `store.subscribe`
  means the SDK also notices token changes your *app* makes, while your app reads
  token/cart/etc. reactively from the same store via `useSessionStore`.
- **Only the token is observed.** `subscribe` is token-only by contract; the other five
  keys are read on demand. Mutate session state through the SDK hooks
  (`useCustomerSession`, `useActiveCompany.setActiveCompany`, `useSiteContext.setSite`, …),
  **not** raw `setState`, or React-Query caches won't be invalidated. `subscribeAll`
  is telemetry-only and drives no refetch.
- **Persistence.** With `persist` over **synchronous** `localStorage`, the store
  rehydrates before the provider's first read, so the SDK sees the persisted token
  immediately (same UX as `createLocalStorageStorage`). With an **async** backing store
  (IndexedDB, RN AsyncStorage) there is a hydration gap — the SDK may read `null` on the
  first tick and treat the user as anonymous until rehydration completes. Without
  `persist` it behaves like `createMemoryStorage`, but app-wide reactive.
- **SSR.** Guard `localStorage` (as shown); on the server the store starts all-`null`
  (anonymous) — identical to the memory fallback.
- **Cross-tab.** `persist` does not sync across tabs by default — same as the built-in
  `localStorage` adapter. Add a `storage`-event listener if you need it.

### Caching & quota

`EmporixProvider` ships with a Balanced React-Query default profile to keep
your tenant API-quota in check:

| Default | Value | Why |
|---|---|---|
| `staleTime` | `30s` | Fresh-within-30s policy reduces refetch-on-mount churn. |
| `refetchOnWindowFocus` | `false` | Tabbing back no longer refetches all queries. |
| `retry` | `1` | Single retry on failure instead of three (caps failed-request cost at 2× per query). |

Each hook overrides `staleTime` for resources that change at different rates:

| Hook(s) | staleTime |
|---|---|
| `useSites`, `useDefaultSite`, `usePaymentModes` | 10 min |
| `useCategory(ies)`, `useCategoryTree`, `useProductsInCategory(Infinite)`, `useMySegment*` | 5 min |
| `useProducts(Infinite)`, `useProduct`, `useProductByCode`, `useProductSearch`, `useMatchPrices` | 60 s |
| `useCustomerSession.customer` (meQuery) | 30 s |
| Everything else | 30 s (provider default) |

These defaults are applied to the `["emporix"]` key namespace of **whatever
QueryClient is active** — including one you pass via the `queryClient` prop, so
a bare `new QueryClient()` (e.g. in the Next.js App Router example) no longer
runs SDK queries with React-Query factory defaults (focus-refetch storms +
`retry: 3` amplifying the SDK's own HTTP retry). The provider only fills gaps:
your explicit choices win, whether set globally (`defaultOptions.queries`) or
emporix-scoped (`qc.setQueryDefaults(["emporix"], …)`), and per-hook options
always win. Queries outside the `["emporix"]` namespace are never touched.

```tsx
const qc = new QueryClient();
// Override our emporix-scoped defaults explicitly if you need to:
qc.setQueryDefaults(["emporix"], { staleTime: 0, retry: false });
<EmporixProvider client={client} queryClient={qc}>...</EmporixProvider>
```

`useActiveCart({ create: true })` and `useCustomerSession.login` share a
`bootstrapCart` cache entry — parallel mounts trigger one server call.
`honourPreferredSite` shares the `meQuery` cache so post-login profile
fetches are deduplicated when timing permits (at worst 2 calls per login).

### Observability

For production tuning and quota monitoring, pass an `onTelemetry` callback
to the provider:

```tsx
<EmporixProvider
  client={client}
  onTelemetry={(event) => {
    switch (event.type) {
      case "cache.hit":
      case "cache.miss":
        datadog.addAction(event.type, { key: event.queryKey });
        break;
      case "query.error":
      case "mutation.error":
        sentry.captureException(event.error, { tags: { type: event.type } });
        break;
      case "auth.refresh":
        if (!event.success) datadog.addError("auth.refresh failed", event);
        break;
      // … cache.miss / mutation.success / storage.write / custom …
    }
  }}
>
```

The event stream is a typed discriminated union — exhaustive switches are
type-safe. Without `onTelemetry`, the whole telemetry layer is no-op and
incurs no overhead.

To emit your own events on the same channel:

```tsx
function CheckoutCTA() {
  const { emit } = useEmporixTelemetry();
  return (
    <button onClick={() => emit({ type: "custom", name: "app.checkout-cta-click" })}>
      Buy
    </button>
  );
}
```

Namespace your custom-event `name` (e.g. `"app.*"`) to avoid collisions with
future SDK event types.

Event types emitted by the SDK:

| Type | Source | Fields |
|---|---|---|
| `cache.hit` | React-Query | `queryKey`, `tenant` |
| `cache.miss` | React-Query | `queryKey`, `tenant`, `durationMs` |
| `query.refetch` | React-Query | `queryKey`, `tenant`, `reason` |
| `query.error` | React-Query | `queryKey`, `tenant`, `error` |
| `mutation.success` | React-Query | `mutationKey?`, `tenant`, `durationMs` |
| `mutation.error` | React-Query | `mutationKey?`, `tenant`, `error`, `durationMs` |
| `auth.refresh` | SDK TokenProvider | `kind`, `tenant`, `success` |
| `storage.write` | EmporixStorage | `key` |
| `company:switched` | `useActiveCompany.setActiveCompany` | `from`, `to`, `durationMs` |
| `custom` | Consumer | `name`, `props?` |

For wiring this channel to **Google Tag Manager / GA4 ecommerce** (and analytics
in general), see [`./analytics.md`](./analytics.md) — it covers the `dataLayer`
bridge, the GA4 event mapping, a `useTrackedCart` wrapper, and SSR + consent.

## Hooks

`useCustomerSession()` — `customerToken`, `customer` (auto-fetched when a token
is present), `isAuthenticated`, `isLoading`, `login`, `signup`, `logout`,
`refresh`. `login` stores the token and invalidates customer + cart queries;
`logout` clears the token and purges the **entire `["emporix"]` query-cache namespace** — including payment modes, orders, segments and catalog/site queries — because customer-scoped caches are keyed by auth kind without a user id and must not survive into the next customer's session. SDK queries refetch on next use; host-app queries outside the `["emporix"]` namespace are untouched.

To refresh the customer token automatically on a 401, opt in with the
`autoRefreshCustomerToken` provider prop (+ `onCustomerSessionExpired`). See
[Customer token auto-refresh](./auth.md#customer-token-auto-refresh-opt-in).

After a successful `login` (or `socialLogin` / `exchangeToken`), the hook runs a best-effort cart-onboarding step: it pulls the customer's open cart from Emporix (`client.carts.getCurrent({ siteCode, create: true })`), merges any guest cart-id from storage into it, and writes the customer-cart-id back to `storage.setCartId(...)`. The UI sees the cart immediately on the next render. See [Customer cart on login](./auth.md#customer-cart-on-login) for the full flow and skip conditions.

Query hooks (`useProduct(s)`, `useProductsInfinite`, `useCategory(ies)`,
`useCategoryTree`, `useCart`) accept `{ auth }` to override the per-call token
kind. Default: `customer` if a token is stored, else `anonymous`. `useCart` is
disabled until a `cartId` is supplied — either explicitly via `useCart(id)` or
implicitly via `storage.getCartId()` when called as `useCart()`.

### Catalog UX

`useProductByCode(code)` — fetches a product by its `code` field. Use for slug-based routes like `/products/[slug]`. Disabled when `code` is undefined/empty.

```tsx
const { data: product } = useProductByCode(params.slug);
```

`useProductSearch(query, params?)` — full-text search. Disabled on empty query — pair with consumer-side debouncing for header search boxes.

```tsx
const [q, setQ] = useState("");
const debounced = useDebounce(q, 300);
const { data } = useProductSearch(debounced, { pageSize: 10 });
```

`useProductsInCategory(categoryId, params?)` — paginated product list for a category page. `useProductsInCategoryInfinite` for infinite scroll, same `hasNextPage`-driven cursor as `useProductsInfinite`.

```tsx
const { data, fetchNextPage, hasNextPage } = useProductsInCategoryInfinite(categoryId, { pageSize: 24 });
const items = data?.pages.flatMap((p) => p.items) ?? [];
```

`useCartMutations(cartId?)` returns `addItem`, `updateItem`, `removeItem`,
`clear`, `applyCoupon`, `removeCoupon`, `setShippingAddress`,
`setBillingAddress` — each a react-query mutation that optimistically patches
the cart cache and rolls back on error. When `cartId` is omitted, the active
cartId is read from `storage` at mutate-time; if storage is empty when a
mutation runs, it rejects with `EmporixError("useCartMutations: no cartId
available …")`. Pair with `useActiveCart` to drop manual cart-id threading:

```tsx
const { data: cart } = useActiveCart({ create: true });
const { addItem } = useCartMutations(); // shares the cart cache with useActiveCart
```

`useCreateCart()` creates a cart and persists the resulting `cartId` so a later
reload can resume the same cart. Auto-detects customer vs anonymous auth from
`storage.getCustomerToken()`.

```tsx
const createCart = useCreateCart();
await createCart.mutateAsync({ currency: "CHF" });
// → POST /cart/{tenant}/carts; storage.setCartId(cartId) is called on success.
```

`useActiveCart(opts?)` resolves to "the active cart" in storage. With `opts.create = true`,
bootstraps a new cart via `client.carts.getCurrent({siteCode, create: true})` if storage
is empty — useful on cart-page mounts where you want a cart unconditionally. Returns
`UseQueryResult<Cart | null>`. `data: null` means "no cart yet and create was not
requested" (deliberate empty-state signal vs. `undefined` = "still loading").

```tsx
// Header mini-cart — read-only, no auto-create:
const { data: cart } = useActiveCart();
const itemCount = cart?.items?.length ?? 0;

// Cart page — auto-create on mount:
const { data: cart, isLoading } = useActiveCart({ create: true });

// B2B quote cart in parallel to the shopping cart:
const { data: quoteCart } = useActiveCart({ create: true, type: "quote" });
```

`useActiveCart` and `useCart(cartId)` share the same React-Query cache entry
when they target the same cart, so optimistic updates from `useCartMutations`
propagate to every cart-aware view. Use `useActiveCart` for "the storefront's
current cart" and `useCart(cartId)` when you already have a specific id (e.g.
from a checkout confirmation page).

### Customer account

For "My Account" pages, five additional hooks complement `useCustomerSession`:

`useUpdateCustomer()` — mutation to PUT a profile patch. Invalidates `useCustomerSession.customer` on success so the UI re-renders with the new value.

`useChangePassword()` — mutation that PUTs `currentPassword` + `newPassword`. Customer-only; throws on missing token.

`useCustomerAddresses()` — list of the logged-in customer's addresses. Disabled until a customer token is in storage.

`useAddressMutations()` — `{ add, update, remove }` mutations for `customer.addresses.*`. Each invalidates `useCustomerAddresses` on success.

`usePasswordReset()` — the 2-step anonymous flow: `{ request, confirm }`. Use on `/forgot-password` and `/reset-password?token=…` routes. Both mutations are anonymous-auth (the user is locked out by definition).

```tsx
const update = useUpdateCustomer();
await update.mutateAsync({ firstName: "New" });

const { add, update: updateAddr, remove } = useAddressMutations();
await add.mutateAsync({ street: "Main St", city: "Zürich", country: "CH" });

const { request, confirm } = usePasswordReset();
await request.mutateAsync({ email: "u@e.com" });             // step 1
await confirm.mutateAsync({ token: "...", newPassword: "..." }); // step 2
```

`useCheckout()` returns `placeOrder` and `placeOrderFromQuote` mutations.
Auto-detects auth: customer if a token is stored, otherwise anonymous (for the
guest-checkout flow). `usePaymentModes()` stays customer-only — payment-mode
listing requires an authenticated session.

### Orders

`useMyOrders` / `useMyOrdersInfinite` — paginated reads of the customer's own orders. `legalEntityId` defaults to the active company from `useActiveCompany`; explicit `null` disables.

`useOrder(orderId)` — single-order read.

`useCancelOrder` / `useOrderTransition` — mutations. Cancel is a sugar for `transition(DECLINED)`.

`useReorder({ orderId })` → `{ added, errors }` — best-effort cart repopulation from a past order; item-level failures land in `errors[]` instead of throwing.

Service-account (backoffice tools): `useSalesOrder(id, auth)` and `useUpdateSalesOrder()` — disabled / throw when `auth` is undefined; caller is responsible for providing an `auth.service()` context.

See [`./orders.md`](./orders.md).

### Sites

For tenants with multiple storefront sites, the SDK exposes the Site Settings
Service and an observable active-site context:

`useSites()` — lists the active sites for the tenant.

`useDefaultSite()` — convenience for "the site flagged as `default: true`".

`useSiteContext()` — returns `{ siteCode, currency, targetLocation, setSite }`
for the **active** site. The provider resolves the initial value from (in
order): the `initialSiteCode` prop → `storage.getSiteCode()` → the static
`client.config.credentials.storefront.context.siteCode` → `null`.

```tsx
<EmporixProvider client={client} storage={storage} initialSiteCode="ThermoBrand_DE">
  <App />
</EmporixProvider>

function SiteSwitcher() {
  const { data: sites } = useSites();
  const { siteCode, setSite } = useSiteContext();
  return (
    <select value={siteCode ?? ""} onChange={(e) => setSite(e.target.value)}>
      {sites?.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
    </select>
  );
}
```

`setSite(code)` writes `storage.setSiteCode(code)`, clears `storage.cartId`
(carts are site-aware), and invalidates `["emporix"]` queries — all
site-aware caches refetch on the new site. Then it PATCHes
`/session-context/{tenant}/me/context` so the server sees the new site on
the next request. The UI flips immediately (optimistic); `isSwitching`
exposes the in-flight PATCH so a switcher button can show a spinner, and
`switchError` carries any PATCH failure (rare — the optimistic state is
NOT rolled back, since the caches already invalidated).

When no cart has been created yet, the server has no session-context for
the user — the SDK skips the PATCH in that case (GET returns 404) and
local state still flips.

`useSiteContext()` exposes `currency` and `targetLocation` derived from the
active site's DTO (cached for 5 minutes via React-Query). On a `setSite`
call, the SDK fetches the new site's DTO, updates these fields, and pushes
all three (`siteCode`, `currency`, `targetLocation`) into the session-context
PATCH. On provider mount with a pre-resolved `siteCode`, the same fetch
happens once so the values are available immediately.

After a successful login, `useCustomerSession` honours `customer.preferredSite`:
if the customer profile carries a preferred site different from the active
one, the SDK calls `setSite(preferredSite)` automatically — including the
server-side PATCH. To opt out, fetch the customer profile first and decide
in your UI before calling `login()` (uncommon; preference-driven behavior
is the expected storefront default).

All site-aware React-Query hooks include `siteCode` in their cache key, so
two `useProducts({pageSize: 12})` calls under different sites yield two
separate cache entries.

### B2B (active company)

`useActiveCompany()` exposes the customer's assigned legal entities, the
currently-active one, and `setActiveCompany(id | null)` to switch (eager
token-refresh + cart-id drop + query invalidation). Hybrid bootstrap:
auto-pick if the customer has exactly one company, leave `mode: "unresolved"`
if multiple. `useCompanySwitcher()` is the UI-friendly wrapper.

Read hooks: `useMyCompanies`, `useCompany`, `useCompanyContacts`,
`useCompanyLocations`, `useCompanyGroups` (IAM, read-only).

Admin mutations require `customermanagement.*_manage` scopes on the
customer token; missing scope surfaces as `EmporixInsufficientScopeError`.

Cart, checkout, addresses and payment-modes hooks include the active
`legalEntityId` in their query keys — switching company invalidates them
automatically. Full surface in [`./b2b.md`](./b2b.md).

### Persistent guest cart

When you use `createLocalStorageStorage()` or `createCookieStorage()` for the
`EmporixProvider`'s `storage` prop, five pieces persist across page reloads:

- `customerToken` — at `emporix.customerToken`; managed by `useCustomerSession`.
- `cartId` — at `emporix.cartId`; set by `useCreateCart`, cleared by your
  consumer on successful `placeOrder` (see `examples/vite-spa`).
- `anonymousSession` — at `emporix.anonymousSession`; `{ refreshToken,
  sessionId }`, written by `DefaultTokenProvider` on every refresh / login,
  read on the first call after a reload.
- `siteCode` — at `emporix.siteCode`; set by `useSiteContext.setSite`.
- `activeLegalEntityId` — at `emporix.activeLegalEntityId`; B2B active
  company, set by `useActiveCompany.setActiveCompany`.
- `refreshToken` — at `emporix.refreshToken`; customer refresh token mirrored
  by `useCustomerSession`. Required for B2B refresh-on-switch — without it,
  `setActiveCompany` falls back to a local-state-only update.

On reload the SDK's first auth call uses the persisted refresh token, which
preserves the same `sessionId` and therefore the access to the anonymous cart.
If the refresh token has expired (Emporix returns 4xx — 24h TTL) the SDK falls
back to a fresh anonymous login (new `sessionId`) and the previous cart becomes
inaccessible. Surface this in the UI as a "discard cart" prompt.

See `examples/vite-spa/src/GuestCheckout.tsx` for the full pattern.

### Coupons

`useValidateCoupon` / `useRedeemCoupon` — mutation hooks for the customer-facing
coupon flows. Both call the Coupon Service with the browser auth context
(customer if logged in, else anonymous) — never the service token. A redemption
payload needs `orderTotal` and `discount`:

```tsx
const validate = useValidateCoupon();
const redeem = useRedeemCoupon();
const redemption = { orderCode: cart.id, orderTotal: { amount: cart.totalPrice, currency: cart.currency }, discount: { amount: 10, currency: cart.currency } };

await validate.mutateAsync({ code: "SUMMER", redemption }); // onError → not redeemable
if (validate.isSuccess) await redeem.mutateAsync({ code: "SUMMER", redemption });
```

Coupon admin CRUD stays server-side (no read hooks). See [`./coupon.md`](./coupon.md).

### Reward points

`useMyRewardPoints` / `useMyRewardPointsSummary` — customer-only queries for the
signed-in shopper's balance (a `number`) and detailed summary. `useRedeemOptions`
— lists redeem options (works for guests and customers). `useRedeemRewardPoints`
— mutation that redeems points for a coupon code (`{ code }`).

```tsx
const { data: balance } = useMyRewardPoints();
const { data: options } = useRedeemOptions();
const redeem = useRedeemRewardPoints();
const { code } = await redeem.mutateAsync({ redeemOptionId: "opt-1" });
```

The three "my" hooks require a logged-in customer. Admin points management stays
server-side. See [`./reward-points.md`](./reward-points.md).

### Returns

`useMyReturns` / `useReturn` — customer-only queries for the signed-in shopper's
returns (list + one). `useCreateReturn` — mutation that files a return request.
All require a logged-in customer and use the customer token.

```tsx
const { data: myReturns } = useMyReturns();
const create = useCreateReturn();
const { id } = await create.mutateAsync({ /* … */ });
```

Return update/delete stay server-side. See [`./returns.md`](./returns.md).

### Approvals

`useApprovals` / `useApproval` — customer-only queries for the signed-in shopper's
B2B approvals (list + one). `useCreateApproval` — files a cart/quote approval
request. `useUpdateApproval` — approves/rejects via a JSON-Patch op-array. All
require a logged-in customer and use the customer token.

```tsx
const { data: approvals } = useApprovals();
const create = useCreateApproval();
const { id } = await create.mutateAsync({ resource: { resourceType: "CART", resourceId } });
const decide = useUpdateApproval();
await decide.mutateAsync({ approvalId: id, ops: [{ op: "replace", path: "/status", value: "APPROVED" }] });
```

`checkPermitted` / `searchApprovers` stay server-side. See [`./approval.md`](./approval.md).

## Errors

`EmporixError` flows unchanged through react-query's `error`. Wrap UI in
`<EmporixErrorBoundary fallback={…}>`; coordinate globally with
`useEmporixErrorHandler({ onAuthError, onError })` (e.g. auto-logout on a
customer-token `EmporixAuthError`).

## SSR / RSC

Two patterns:

1. **App Router (RSC)** — call the SDK directly in server components; for client
   hydration, `prefetchProduct` / `prefetchCart` into a `QueryClient` then
   dehydrate. Read the customer token from a cookie/header in a server component
   and pass it as `initialCustomerToken`.
2. **Pages Router / SPA hydration** — prefetch into a `QueryClient`, dehydrate,
   rehydrate on the client.

Critical rule: `EmporixClient` is created **once per server**, never per
request. Never put a per-request client in module scope.

### Common pitfalls

- **Per-request client** — recreating `EmporixClient` per request defeats token
  caching and leaks state. One per server.
- **Token hydration** — the server reads the cookie and passes
  `initialCustomerToken`; the client provider seeds storage from it so the first
  render is authenticated (no flash of logged-out UI).
- **Cart-merge timing** — log the customer in *before* merging the anonymous
  cart; merge requires the customer token and the preserved `sessionId` (see
  [`auth.md`](./auth.md)).

See [`examples/next-app-router`](../examples/next-app-router) and
[`examples/vite-spa`](../examples/vite-spa) for working setups.
