# @viu/emporix-sdk-react

[![CI](https://github.com/viuteam/emporix-sdk/actions/workflows/pr-check.yml/badge.svg?branch=main)](https://github.com/viuteam/emporix-sdk/actions/workflows/pr-check.yml)
[![npm](https://img.shields.io/npm/v/@viu/emporix-sdk-react)](https://www.npmjs.com/package/@viu/emporix-sdk-react)

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
import { EmporixProvider, createLocalStorage } from "@viu/emporix-sdk-react";

const client = new EmporixClient({
  tenant: "mytenant",
  credentials: { backend: { clientId: "", secret: "" }, storefront: { clientId: "x" } },
});

<EmporixProvider client={client} storage={createLocalStorage()}>
  <App />
</EmporixProvider>;
```

Create `EmporixClient` **once** (per app, or once per server for SSR) — never
per request/render.

## Hooks

| Hook | Purpose |
| --- | --- |
| `useEmporix()` | the provider's `{ client, storage }` — escape hatch for direct SDK calls |
| `useCustomerSession()` | `customerToken`, `customer`, `isAuthenticated`, `login`, `signup`, `logout`, `refresh` |
| `useUpdateCustomer` / `useChangePassword` / `usePasswordReset` | account management |
| `useChangeEmail` / `useConfirmEmailChange` | email change + confirmation |
| `useConfirmSignup` / `useResendActivation` | signup activation |
| `useAddSessionAttribute` / `useRemoveSessionAttribute` | customer session attributes |
| `useCustomerAddresses` / `useCustomerAddress` / `useAddressMutations` | address CRUD |
| `useAddAddressTags` / `useRemoveAddressTags` | address tagging |
| `useProduct` / `useProducts` / `useProductsInfinite` / `useProductByCode` / `useProductsByCodes` / `useProductSearch` / `useProductNameSearch` / `useVariantChildren` | product reads |
| `useCategory` / `useCategories` / `useCategoriesInfinite` / `useCategoryTree` / `useCategoryTreeById` / `useProductsInCategory(Infinite)` / `useCategorySearch` | category reads |
| `useSubcategories` / `useChildCategories` / `useCategoryParents` | category tree navigation |
| `useCart(cartId?)` / `useActiveCart(opts?)` / `useCreateCart()` / `useCartItems()` | cart read + bootstrap |
| `useCartMutations(cartId?)` | add/update/remove/clear/coupons/addresses — optimistic + rollback |
| `useCartValidation()` | cart item validation |
| `useCheckout()` / `usePaymentModes()` / `usePaymentMode()` / `useInitializePayment()` | checkout flow + payment modes |
| `useShippingZones()` | shipping zone reads |
| `useMatchPrices()` / `useMatchPricesChunked()` | price matching (chunked variant for large carts) |
| `useProductMedia()` | product media reads |
| `useMyOrders` / `useMyOrdersInfinite` / `useOrder` / `useCancelOrder` / `useOrderTransition` / `useReorder` | order history + actions |
| `useSalesOrder` / `useUpdateSalesOrder` | sales-order read + update |
| `useAvailability` / `useAvailabilities` | site-aware availability reads |
| `useValidateCoupon` / `useRedeemCoupon` | coupon validation + redemption |
| `useMyRewardPoints` / `useMyRewardPointsSummary` / `useRedeemOptions` / `useRedeemRewardPoints` | reward points |
| `useMyReturns` / `useReturn` / `useCreateReturn` | returns (RMA) self-service |
| `useApprovals` / `useApproval` / `useCreateApproval` / `useUpdateApproval` | B2B approval workflows |
| `useShoppingLists` / `useCreateShoppingList` / `useDeleteShoppingList` / `useAddToShoppingList` / `useRemoveFromShoppingList` / `useSetShoppingListItemQuantity` | shopping lists |
| `useMySegments` / `useMySegmentItems` / `useMySegment{Products,Categories}(Infinite)` / `useMySegmentCategoryTree` | customer-segment reads |
| `useSites` / `useDefaultSite` / `useActiveSite` / `useSiteContext` | multi-site context |
| `useActiveCompany` / `useCompanySwitcher` | active legal entity (B2B) |
| `useMyCompanies` / `useCompany` / `useCompanyContacts` / `useCompanyLocations` / `useCompanyGroups` | B2B reads |
| `useCreateCompany` / `useUpdateCompany` / `useDeleteCompany` | B2B admin mutations |
| `useAssignContact` / `useUpdateContactAssignment` / `useUnassignContact` | B2B contact-assignment mutations |
| `useCreateLocation` / `useUpdateLocation` / `useDeleteLocation` | B2B location mutations |
| `useAddGroupMember` / `useRemoveGroupMember` | B2B customer-group membership |
| `useCloudFunction` / `useInvokeCloudFunction` | Emporix-hosted cloud functions |

`useProductSearch`, `useCategorySearch` and `useMyOrders({ q })` accept a raw
`q` string **or** a type-safe mixin filter built with `mixinQuery` from
`@viu/emporix-mixins` — see [`../../docs/mixin-search.md`](../../docs/mixin-search.md).

Query keys are namespaced `["emporix", resource, ...args, meta]` where `meta`
holds the cache discriminators — at minimum `{ tenant, authKind }`, plus
`siteCode` for site-aware hooks and `legalEntityId` for B2B-aware hooks (cart,
checkout, addresses, etc. invalidate automatically on company switch).
Every query hook accepts `{ auth }` to override the token kind for that
call (default: `customer` if a token is stored, else `anonymous`).

## Storage adapters

`createMemoryStorage` (default, SSR-safe), `createLocalStorage`,
`createSessionStorage` (per-tab: survives reload, cleared on tab close),
`createCookieStorage`. `createLocalStorageStorage` is a deprecated alias of
`createLocalStorage`. Trade-offs and CSRF notes in
[`../../docs/react.md`](../../docs/react.md).

## Errors & SSR

`<EmporixErrorBoundary>` and `useEmporixErrorHandler` for error coordination;
`prefetchProduct` / `prefetchCart` / `prefetchOrder` for server-side hydration. See
[`../../docs/react.md`](../../docs/react.md).

## Analytics & tracking

A typed, no-op-by-default telemetry channel (`onTelemetry` + `useEmporixTelemetry`)
feeds any analytics sink. For Google Tag Manager / GA4 ecommerce — the `dataLayer`
bridge, GA4 event mapping, a `useTrackedCart` wrapper, SSR + consent — see
[`../../docs/analytics.md`](../../docs/analytics.md).

## Subpath exports

`.`, `./provider`, `./hooks`, `./storage`, `./ssr`.

## Authors

- **Dominic Fritschi** — _Maintainer_ — [VIU](https://www.viu.ch)
- **Andreas Nebiker** — _Contributor_ — [VIU](https://www.viu.ch)
- The **Team at VIU** — _Contributors_ — [VIU](https://www.viu.ch)

## License

This project is licensed under the MIT License — see the [LICENSE](./LICENSE) file for details.
