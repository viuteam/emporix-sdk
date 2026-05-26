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
| `useProduct` / `useProducts` / `useProductsInfinite` / `useProductByCode` / `useProductSearch` | product reads |
| `useCategory` / `useCategories` / `useCategoryTree` / `useProductsInCategory(Infinite)` | category reads |
| `useCart(cartId?)` / `useActiveCart(opts?)` / `useCreateCart()` | cart read + bootstrap |
| `useCartMutations(cartId?)` | add/update/remove/clear/coupons/addresses — optimistic + rollback |
| `useCheckout()` / `usePaymentModes()` | checkout flow + payment-mode list |
| `useMatchPrices()` / `useProductMedia()` | price + media reads |
| `useMySegments` / `useMySegmentItems` / `useMySegment{Products,Categories}(Infinite)` / `useMySegmentCategoryTree` | customer-segment reads |
| `useUpdateCustomer` / `useChangePassword` / `usePasswordReset` | account management |
| `useCustomerAddresses` / `useAddressMutations` | address CRUD |
| `useSites` / `useDefaultSite` / `useSiteContext` | multi-site context |
| `useActiveCompany` / `useCompanySwitcher` | active legal entity (B2B) |
| `useMyCompanies` / `useCompany` / `useCompanyContacts` / `useCompanyLocations` / `useCompanyGroups` | B2B reads |
| `useCreateCompany` / `useUpdateCompany` / `useDeleteCompany` | B2B admin mutations |
| `useAssignContact` / `useUpdateContactAssignment` / `useUnassignContact` | B2B contact-assignment mutations |
| `useCreateLocation` / `useUpdateLocation` / `useDeleteLocation` | B2B location mutations |

Query keys are namespaced `["emporix", resource, ...args, meta]` where `meta`
holds the cache discriminators — at minimum `{ tenant, authKind }`, plus
`siteCode` for site-aware hooks and `legalEntityId` for B2B-aware hooks (cart,
checkout, addresses, etc. invalidate automatically on company switch).
Every query hook accepts `{ auth }` to override the token kind for that
call (default: `customer` if a token is stored, else `anonymous`).

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

## Authors

- **Dominic Fritschi** — _Maintainer_ — [VIU](https://www.viu.ch)
- **Andreas Nebiker** — _Contributor_ — [VIU](https://www.viu.ch)
- The **Team at VIU** — _Contributors_ — [VIU](https://www.viu.ch)

## License

This project is licensed under the MIT License — see the [LICENSE](./LICENSE) file for details.
