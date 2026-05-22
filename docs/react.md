# React integration

`@viu/emporix-sdk-react` wraps the core SDK with `@tanstack/react-query` v5.
The core SDK has **no** React dependency; React lives only in this package.

## Provider

```tsx
<EmporixProvider client={client} queryClient={qc?} storage={storage?} initialCustomerToken={token?}>
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
| `createLocalStorageStorage` | `localStorage` | browser only; falls back to memory + warns on the server |
| `createCookieStorage` | cookie | you must set `sameSite`/`secure`; readable by JS unless you manage an httpOnly cookie server-side |

Storage choices have security implications (XSS for `localStorage`, CSRF for
cookies) the SDK cannot make for you — hence opt-in, never automatic.

Each adapter persists three pieces under predictable keys:

- `emporix.customerToken` — string, set by `useCustomerSession.login/logout`.
- `emporix.cartId` — string, set by `useCreateCart`, cleared by the consumer.
- `emporix.anonymousSession` — JSON `{ refreshToken, sessionId }`, set by the
  SDK on every anonymous login/refresh. See [Persistent guest cart](#persistent-guest-cart).

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

To opt out and supply your own defaults, pass a `queryClient` prop:

```tsx
const qc = new QueryClient(); // your own defaults
<EmporixProvider client={client} queryClient={qc}>...</EmporixProvider>
```

`useActiveCart({ create: true })` and `useCustomerSession.login` share a
`bootstrapCart` cache entry — parallel mounts trigger one server call.
`honourPreferredSite` shares the `meQuery` cache so post-login profile
fetches are deduplicated when timing permits (at worst 2 calls per login).

## Hooks

`useCustomerSession()` — `customerToken`, `customer` (auto-fetched when a token
is present), `isAuthenticated`, `isLoading`, `login`, `signup`, `logout`,
`refresh`. `login` stores the token and invalidates customer + cart queries;
`logout` clears the token and removes those queries.

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

### Persistent guest cart

When you use `createLocalStorageStorage()` or `createCookieStorage()` for the
`EmporixProvider`'s `storage` prop, three pieces persist across page reloads:

- `customerToken` — at `emporix.customerToken`; managed by `useCustomerSession`.
- `cartId` — at `emporix.cartId`; set by `useCreateCart`, cleared by your
  consumer on successful `placeOrder` (see `examples/vite-spa`).
- `anonymousSession` — at `emporix.anonymousSession`; `{ refreshToken,
  sessionId }`, written by `DefaultTokenProvider` on every refresh / login,
  read on the first call after a reload.

On reload the SDK's first auth call uses the persisted refresh token, which
preserves the same `sessionId` and therefore the access to the anonymous cart.
If the refresh token has expired (Emporix returns 4xx — 24h TTL) the SDK falls
back to a fresh anonymous login (new `sessionId`) and the previous cart becomes
inaccessible. Surface this in the UI as a "discard cart" prompt.

See `examples/vite-spa/src/GuestCheckout.tsx` for the full pattern.

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
