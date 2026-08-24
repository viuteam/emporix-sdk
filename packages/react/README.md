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

## Managed Dashboard module (host-owned token)

Emporix's [`md-module-template`](https://github.com/emporix/md-module-template) is a Module
Federation remote. The Managed Dashboard loads it and passes one object:

```ts
type AppState = { tenant: string; language: string; token: string }
```

The module never authenticates — that `token` is a customer token whose scopes reach
operations a storefront token could not. `customerSession="external"` is how you tell the
provider so:

```tsx
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "@viu/emporix-sdk-react";

const clients = new Map<string, EmporixClient>();
const clientFor = (tenant: string) => {
  let c = clients.get(tenant);
  if (!c) {
    // No credentials: the host owns the token. `host` must be explicit — the
    // template's VITE_API_URL points at a different environment than the
    // SDK's default.
    c = new EmporixClient({ tenant, host: import.meta.env.VITE_API_URL, credentials: {} });
    clients.set(tenant, c);
  }
  return c;
};

const RemoteComponent = ({ appState }: { appState: AppState }) => (
  <EmporixProvider
    client={clientFor(appState.tenant)}
    initialCustomerToken={appState.token}
    initialLanguage={appState.language}
    customerSession="external"
    onCustomerSessionExpired={() => setSessionDead(true)}
  >
    <YourModule />
  </EmporixProvider>
);
```

Every hook now works on the host's token — including the token-gated ones (`useOrder`,
`useMyOrders`, the cart hooks), which an `auth.raw(...)` per-call override cannot reach.

**What `customerSession="external"` changes**

| | `"owned"` (default) | `"external"` |
| --- | --- | --- |
| `companies.listMine()` on mount | yes, when a token is present | **never** |
| refresh on a customer 401 | only with `autoRefreshCustomerToken` | **never**; `onCustomerSessionExpired` fires and the 401 propagates |
| a changed `initialCustomerToken` | seeds only an empty slot | **authoritative** — written into storage |

**Six things to get right**

1. **No `storage` prop.** A federation remote runs on the host's origin, so
   `createLocalStorage()` would write `emporix.customerToken` into the dashboard's own
   `localStorage`. The default memory storage ties the token's lifetime to the module's.
2. **Pass `initialLanguage`.** Without it the provider seeds the language from the active
   site *after* mount, which moves the query key and orphans anything already fetched. The
   host already knows the language.
3. **One client per tenant, memoized on tenant — not on the token.** The token is a request
   credential; rebuilding the client on rotation throws away its caches.
4. **Do not pass `initialSiteCode`** unless the token can read sites. It triggers a site
   fetch whose failure is swallowed.
5. **Federation `shared`:** keep `react` and `react-dom` shared with the host — two React
   copies break every hook. Use the **array** form (`shared: ["react", "react-dom"]`), not the
   object form with `requiredVersion`: the dashboard provides React with no version metadata,
   so a version check fails with «provider support react(undefined) is not satisfied», the
   shared React is discarded, and the first hook dies on `Cannot read properties of null
   (reading 'useState')`. Do **not** share `@viu/emporix-sdk`, `@viu/emporix-sdk-react` or
   `@tanstack/react-query`; the host does not know your versions, and the module owns its own
   cache.
6. **Build against the React major the host runs** — 18.3 for the Management Dashboard today.
   This package's peer range accepts 18 and 19, but that is about *this package*, not about
   federation. React 18 and 19 produce differently shaped elements (19 drops `ref` from the
   element and uses a different `$$typeof`), so a React-19 module inside a React-18 host throws
   React error #31, «Objects are not valid as a React child». Avoiding React-19-only APIs does
   not help — it is a format break, not an API question.

A working remote is in [`examples/md-module`](../../examples/md-module).

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

Admin-only services have no hooks here on purpose — the import service is the
clearest case: every one of its operations needs client-credentials with the
`importtool.import_trigger` scope, and `EmporixProvider` is configured with a
public storefront client id, so a hook would mean a secret in the browser bundle.
Call it from a server route instead ([`../../docs/import.md`](../../docs/import.md)).

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

`<EmporixErrorBoundary>` and `useEmporixErrorHandler` for error coordination.
For servers (RSC, Server Actions, Remix/SvelteKit loaders): `createServerStorage`
+ `serverAuth` resolve the session from an injected cookie jar, and
`prefetchEmporix` prefills the cache for any read hook (`prefetchProduct` /
`prefetchCart` / `prefetchOrder` are convenience wrappers). All from
`@viu/emporix-sdk-react/ssr`, which carries no `"use client"` directive. See
[`../../docs/react.md`](../../docs/react.md).

## Analytics & tracking

A typed, no-op-by-default telemetry channel (`onTelemetry` + `useEmporixTelemetry`)
feeds any analytics sink. For Google Tag Manager / GA4 ecommerce — the `dataLayer`
bridge, GA4 event mapping, a `useTrackedCart` wrapper, SSR + consent — see
[`../../docs/analytics.md`](../../docs/analytics.md).

## Subpath exports

`.`, `./provider`, `./hooks`, `./storage`, `./ssr`.

## Changelog

npmjs.com renders only this README, never a changelog — the registry has no field
for one. The per-version history lives here instead:

- [`CHANGELOG.md`](https://github.com/viuteam/emporix-sdk/blob/main/packages/react/CHANGELOG.md)
  — the whole history in one file. Also shipped inside the published tarball, so
  [unpkg serves it](https://unpkg.com/@viu/emporix-sdk-react/CHANGELOG.md) straight
  from the release artifact.
- [Releases](https://github.com/viuteam/emporix-sdk/releases) — one entry per
  published version, each linking the PR and the commit behind every change.

## Authors

- **Dominic Fritschi** — _Maintainer_ — [VIU](https://www.viu.ch)
- **Andreas Nebiker** — _Contributor_ — [VIU](https://www.viu.ch)
- The **Team at VIU** — _Contributors_ — [VIU](https://www.viu.ch)

## License

This project is licensed under the MIT License — see the [LICENSE](./LICENSE) file for details.
