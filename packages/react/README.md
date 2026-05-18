# @viu/emporix-sdk-react

React bindings for `@viu/emporix-sdk`, built on
[`@tanstack/react-query`](https://tanstack.com/query) v5. Supports React 18 & 19.

## Install

```bash
pnpm add @viu/emporix-sdk-react @viu/emporix-sdk @tanstack/react-query react
```

`@viu/emporix-sdk`, `@tanstack/react-query` and `react` are peer dependencies.

## Provider

```tsx
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider, createLocalStorageStorage } from "@viu/emporix-sdk-react";

const client = new EmporixClient({
  tenant: "mytenant",
  credentials: { backend: { clientId: "", secret: "" }, storefront: { clientId: "x" } },
});

<EmporixProvider client={client} storage={createLocalStorageStorage()}>
  <App />
</EmporixProvider>;
```

Create `EmporixClient` **once** (per app, or once per server for SSR) — never
per request/render.

## Hooks

| Hook | Purpose |
| --- | --- |
| `useCustomerSession()` | `customerToken`, `customer`, `isAuthenticated`, `login`, `signup`, `logout`, `refresh` |
| `useProduct` / `useProducts` / `useProductsInfinite` | product reads |
| `useCategory` / `useCategories` / `useCategoryTree` | category reads |
| `useCart(cartId?)` | cart read (disabled without `cartId`) |
| `useCartMutations(cartId)` | add/update/remove/clear/coupons/addresses — optimistic + rollback |

Query keys are namespaced `["emporix", resource, id, { tenant, authKind }]`, so
cache is scoped per tenant and per auth kind. Every query hook accepts
`{ auth }` to override the token kind for that call (default: `customer` if a
token is stored, else `anonymous`).

## Storage adapters

`createMemoryStorage` (default, SSR-safe), `createLocalStorageStorage`,
`createCookieStorage`. Trade-offs and CSRF notes in
[`../../docs/react.md`](../../docs/react.md).

## Errors & SSR

`<EmporixErrorBoundary>` and `useEmporixErrorHandler` for error coordination;
`prefetchProduct` / `prefetchCart` for server-side hydration. See
[`../../docs/react.md`](../../docs/react.md).

## Subpath exports

`.`, `./provider`, `./hooks`, `./storage`, `./ssr`.
