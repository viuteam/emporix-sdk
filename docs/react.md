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

## Hooks

`useCustomerSession()` — `customerToken`, `customer` (auto-fetched when a token
is present), `isAuthenticated`, `isLoading`, `login`, `signup`, `logout`,
`refresh`. `login` stores the token and invalidates customer + cart queries;
`logout` clears the token and removes those queries.

Query hooks (`useProduct(s)`, `useProductsInfinite`, `useCategory(ies)`,
`useCategoryTree`, `useCart`) accept `{ auth }` to override the per-call token
kind. Default: `customer` if a token is stored, else `anonymous`. `useCart` is
disabled until a `cartId` is supplied.

`useCartMutations(cartId)` returns `addItem`, `updateItem`, `removeItem`,
`clear`, `applyCoupon`, `removeCoupon`, `setShippingAddress`,
`setBillingAddress` — each a react-query mutation that optimistically patches
the `useCart` cache and rolls back on error.

`useCreateCart()` creates a cart and persists the resulting `cartId` so a later
reload can resume the same cart. Auto-detects customer vs anonymous auth from
`storage.getCustomerToken()`.

```tsx
const createCart = useCreateCart();
await createCart.mutateAsync({ currency: "CHF" });
// → POST /cart/{tenant}/carts; storage.setCartId(cartId) is called on success.
```

`useCheckout()` returns `placeOrder` and `placeOrderFromQuote` mutations.
Auto-detects auth: customer if a token is stored, otherwise anonymous (for the
guest-checkout flow). `usePaymentModes()` stays customer-only — payment-mode
listing requires an authenticated session.

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
