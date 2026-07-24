# @viu/emporix-sdk

## 2.22.0

### Minor Changes

- [#160](https://github.com/viuteam/emporix-sdk/pull/160) [`7a63559`](https://github.com/viuteam/emporix-sdk/commit/7a635592f7233dc35f35502538d6695d428897cf) Thanks [@amnael1](https://github.com/amnael1)! - Add storefront-facing facade methods and matching React hooks. Additive and
  backward-compatible.
  - **Cart** — `carts.validate`, `listItems`, `refresh`, `changeSite`,
    `changeCurrency`, `updateItemsBatch` (state-changing ops re-fetch and return
    the updated cart). Hooks: `useCartValidation`, `useCartItems`, and
    `refresh`/`changeSite`/`changeCurrency`/`updateItemsBatch` on the
    `useCartMutations` bundle.
  - **Customer** — double opt-in (`confirmSignup`/`resendActivation`),
    login-email change (`changeEmail`/`confirmEmailChange`), and address
    `get`/`addTags`/`removeTags`. Hooks: `useConfirmSignup`,
    `useResendActivation`, `useChangeEmail`, `useConfirmEmailChange`,
    `useCustomerAddress`, `useAddAddressTags`, `useRemoveAddressTags`.
  - **Category** — `categories.parents`, `childCategories` (dedicated
    `/subcategories`), `getTree` (single tree by id). Hooks:
    `useCategoryParents`, `useChildCategories`, `useCategoryTreeById`.
  - **Payment** — `payments.getMode`, `initialize` (frontend, no scope). Hooks:
    `usePaymentMode`, `useInitializePayment`.
  - **Session context** — `sessionContext.addAttribute`/`removeAttribute`. Hooks:
    `useAddSessionAttribute`, `useRemoveSessionAttribute`.

## 2.21.0

### Minor Changes

- [#154](https://github.com/viuteam/emporix-sdk/pull/154) [`2c170d1`](https://github.com/viuteam/emporix-sdk/commit/2c170d182a2839bb39aba47a4075ee820195813a) Thanks [@amnael1](https://github.com/amnael1)! - Add full `AiService` parity with the ai-service API. New CRUD sub-resources
  `ai.tools`, `ai.mcpServers`, `ai.tokens`, `ai.oauths` (list/search/get/upsert/patch/delete);
  new resource groups `ai.jobs`, `ai.templates`, `ai.logs`, `ai.analytics`; and
  new methods `ai.listModels`, `ai.listCommerceEvents`, `ai.uploadAttachment`,
  `ai.exportAgents`, `ai.importAgents`.

- [#157](https://github.com/viuteam/emporix-sdk/pull/157) [`f7e9839`](https://github.com/viuteam/emporix-sdk/commit/f7e983928c3d91d3093c875a3fef5c15d59133c0) Thanks [@amnael1](https://github.com/amnael1)! - Add `client.invoices` (invoice-generation jobs) and `client.quotes` (B2B quotes
  CRUD + PDF + history, with a `client.quotes.reasons` config sub-resource),
  backed by the generated `invoice` / `quote` types. Quote-domain methods take a
  required `auth` argument (customer or admin token — quotes are never
  anonymous). The OAuth Service is intentionally not wrapped — its token grant is
  owned by the SDK auth core.

- [#156](https://github.com/viuteam/emporix-sdk/pull/156) [`61df99e`](https://github.com/viuteam/emporix-sdk/commit/61df99ec09be5ff69327a3f70b82be58b7c90d34) Thanks [@amnael1](https://github.com/amnael1)! - Derive `SiteService` and `SessionContextService` public types from the
  generated `site-settings-service` / `session-context` types. `Site` now
  inherits every generated field (shipping/payment/tax/assistedBuying/mixins/
  taxDeterminationBasedOn, richer address) while keeping `active`/`default`
  required; `SessionContext.sessionId` stays required and the ergonomic flat
  `patch({ …, version })` DX is unchanged. Note: `SessionContext.context` /
  `SessionContextPatch.context` are now the accurate nested map type
  (`Record<string, Record<string, unknown>>`) instead of `Record<string, unknown>`.

### Patch Changes

- [#151](https://github.com/viuteam/emporix-sdk/pull/151) [`7aa5fc9`](https://github.com/viuteam/emporix-sdk/commit/7aa5fc93c5ef6a83f7235b76e4e5ccc9bb545d33) Thanks [@viu-release-bot](https://github.com/apps/viu-release-bot)! - chore(sdk): sync generated types with upstream Emporix API specs

  Updated services: ai-service

- [#159](https://github.com/viuteam/emporix-sdk/pull/159) [`7a7c90c`](https://github.com/viuteam/emporix-sdk/commit/7a7c90c7d569988dfdce8ca84ea261d311a419e7) Thanks [@amnael1](https://github.com/amnael1)! - Fix four facade methods that targeted HTTP paths/methods the live Emporix API
  rejects (verified against the tenant). Signatures are unchanged.
  - `cart.applyCoupon` / `cart.removeCoupon` used `…/carts/{id}/coupons`, which
    returns 404 "No endpoint". Coupons are applied via the cart **discounts**
    endpoint: `applyCoupon` now `POST …/discounts` (coupon-code payload),
    `removeCoupon` now `DELETE …/discounts?codes=<code>`. Both re-fetch and return
    the updated cart.
  - `customer.changePassword` used `PUT …/password` (404). Now `POST …/password/change`.
  - `customer.confirmPasswordReset` used `POST …/password/reset/confirm` (404). Now
    `POST …/password/reset/update`.
  - `companies.update` / `contacts.update` / `locations.update` used `PATCH`, which
    the customer-management API rejects with 405 Method Not Allowed. Now `PUT`
    (upsert). Send the complete entity, as the server replaces the resource.

- [#155](https://github.com/viuteam/emporix-sdk/pull/155) [`c78ce7b`](https://github.com/viuteam/emporix-sdk/commit/c78ce7bb25c0208b02a4469904c56c38b11cc6cf) Thanks [@amnael1](https://github.com/amnael1)! - Register the five remaining Emporix OpenAPI specs that were missing from the
  fetch registry — `oauth-service`, `site-settings-service`, `invoice`, `quote`,
  `session-context` — so the SDK vendors and generates types for all 43 listed
  API services. Generated types only; no new service facades.

## 2.20.1

### Patch Changes

- [#149](https://github.com/viuteam/emporix-sdk/pull/149) [`7aed273`](https://github.com/viuteam/emporix-sdk/commit/7aed273c04af463edba7c749113d31c44eca6607) Thanks [@viu-release-bot](https://github.com/apps/viu-release-bot)! - chore(sdk): sync generated types with upstream Emporix API specs

  Updated services: schema

## 2.20.0

### Minor Changes

- [#148](https://github.com/viuteam/emporix-sdk/pull/148) [`176d098`](https://github.com/viuteam/emporix-sdk/commit/176d09873362be9f63a0867a0d8b7393ba047841) Thanks [@amnael1](https://github.com/amnael1)! - feat(sdk): expose new Emporix endpoints and add SSE streaming

  From the 2026-07 upstream sync:
  - `ai.chatStream(input, { sessionId })` — streaming agent chat over Server-Sent
    Events; yields each SSE `data` payload.
  - `ai.listConversations()` / `ai.searchConversations({ q })`.
  - `category.rebuildTree(rootCategoryId)`.
  - `schema.bulkPatchInstances(type, items)` — bulk PATCH (207 per-item results).
  - New core capability `HttpClient.requestStream` for `text/event-stream` responses.

### Patch Changes

- [#143](https://github.com/viuteam/emporix-sdk/pull/143) [`36b2a23`](https://github.com/viuteam/emporix-sdk/commit/36b2a2333eb8896ec37a6dff3750d5ee669d3f52) Thanks [@amnael1](https://github.com/amnael1)! - Add a daily GitHub Actions workflow that re-fetches the vendored Emporix OpenAPI specs, regenerates the SDK types, smoke-tests the bundle via `check:treeshake`, and opens/updates a single PR whenever the specs drift from upstream.

- [#147](https://github.com/viuteam/emporix-sdk/pull/147) [`49de856`](https://github.com/viuteam/emporix-sdk/commit/49de8562eac2b8a8f24c27828ac15441a39c9d21) Thanks [@viu-release-bot](https://github.com/apps/viu-release-bot)! - chore(sdk): sync generated types with upstream Emporix API specs

  Updated services: ai-rag-indexer,ai-service,cart,category,country-service,iam,indexing-service,media,order-v2,price,product,schema,webhook

## 2.19.0

### Minor Changes

- [#139](https://github.com/viuteam/emporix-sdk/pull/139) [`1b17743`](https://github.com/viuteam/emporix-sdk/commit/1b17743719e03146c1a66a8ebd3f02c25dd48590) Thanks [@amnael1](https://github.com/amnael1)! - Sync with the Emporix changelog (2026-06-18). New indexing reindex-jobs API:
  `indexing.createReindexJob`, `indexing.listReindexJobs`, `indexing.getReindexJob`
  (replacing the now-deprecated `indexing.reindex`). Deprecated `ragIndexer.reindex`
  (use `indexing.createReindexJob({ entityType: "PRODUCT", rag: true })`), the whole
  `SepaExportService` and `PickPackService`, and the deprecated approval price fields.
  Availability is now fetched + vendored through the codegen pipeline. Adds upstream
  version tracking: `specs/.sync-manifest.json` (written by `fetch-specs`) plus
  `docs/emporix-upstream-changelog.md`.

## 2.18.0

### Minor Changes

- [#137](https://github.com/viuteam/emporix-sdk/pull/137) [`9ef7c51`](https://github.com/viuteam/emporix-sdk/commit/9ef7c51d933d9b78be1880ce19d6f7312ffcd20e) Thanks [@amnael1](https://github.com/amnael1)! - Add a type-safe mixin filter builder. `@viu/emporix-mixins` now exports
  `mixinQuery`/`and`/`or`/`raw` to build Emporix `q` filters from generated
  `MixinDescriptor`s, with attribute names and value types checked at compile
  time and the entity carried through `MixinDescriptor<T, E>` / `MixinFilter<E>`.
  Localized attributes are supported via a `{ lang, ... }` operator.
  `products.search` and `useProductSearch` accept a built filter (or a raw
  string); a new `resolveQuery` normalizer enforces the `compoundLogicalQuery`
  (OR) capability gate per service.

- [#137](https://github.com/viuteam/emporix-sdk/pull/137) [`de6e8b8`](https://github.com/viuteam/emporix-sdk/commit/de6e8b8727c5150f9fe3df77820dd13b6cf37e24) Thanks [@amnael1](https://github.com/amnael1)! - Wire the mixin filter builder into more services. `categories.search`,
  `orders.listMine({ q })`, `customerAdmin.searchCustomers({ q })` and
  `vendor.searchVendors({ q })` now accept a built mixin filter (or a raw `q`
  string), each entity-gated via `QueryFor<E>` and routed through `resolveQuery`
  (all are non-compound, so `or()` filters are rejected). New React hooks:
  `useCategorySearch` and a `q` option on `useMyOrders`.

## 2.16.0

### Patch Changes

- [#134](https://github.com/viuteam/emporix-sdk/pull/134) [`f3f29aa`](https://github.com/viuteam/emporix-sdk/commit/f3f29aab5dd364d4ebaa5edf5ace524222dad6be) Thanks [@amnael1](https://github.com/amnael1)! - `client.payments.listPaymentModes` no longer requires a customer token. It now
  defaults to an anonymous context, matching the public frontend payment-modes
  endpoint (which needs a bearer token but no customer scope), so storefronts can
  list configured payment modes for guests as well as logged-in customers.

## 2.15.0

### Minor Changes

- [#129](https://github.com/viuteam/emporix-sdk/pull/129) [`05cf47c`](https://github.com/viuteam/emporix-sdk/commit/05cf47ca6f21dfb6e14b2bfdda2d88d11e55eaf9) Thanks [@amnael1](https://github.com/amnael1)! - add `createEmporixClient(config, services)` — a tree-shakeable, opt-in client factory that instantiates only the service classes you pass (e.g. `{ products: ProductService, carts: CartService }`), so bundlers drop every service you don't use. Service classes now carry static `channel`/`deps` metadata; `createCore(config)` exposes the shared infrastructure. `EmporixClient` is unchanged — it stays the batteries-included default that bundles everything — so this is purely additive.

## 2.14.0

### Minor Changes

- [#127](https://github.com/viuteam/emporix-sdk/pull/127) [`5769d9e`](https://github.com/viuteam/emporix-sdk/commit/5769d9e5e4a7fb9dc468968785c190c2f4fd8944) Thanks [@amnael1](https://github.com/amnael1)! - harden the HTTP and token layers: timeouts and connection failures now throw typed `EmporixTimeoutError`/`EmporixNetworkError` (previously raw `AbortError`/`TypeError` escaped the SDK's error taxonomy); the response body read is bounded by the timeout (a stalled stream no longer hangs forever); `timeouts.connectMs` is now actually enforced as the time-to-headers budget; `/oauth/token` and anonymous-login fetches are bounded by `timeouts.readMs` (one hung token call no longer blocks every request behind the single-flight lock); `login`/`refresh`/`socialLogin`/`exchangeToken` now throw `EmporixAuthError` on a 2xx response missing `access_token` instead of fabricating an empty session; read-only POST search endpoints (`products.searchByIds`/`searchByCodes`, `price.match`/`matchByContext`, `availability.getMany`, category product search) are marked `idempotent: true` and retry on 5xx/429 again.

- [#125](https://github.com/viuteam/emporix-sdk/pull/125) [`236caa3`](https://github.com/viuteam/emporix-sdk/commit/236caa3d42565852ce2240498794accc6c897f67) Thanks [@amnael1](https://github.com/amnael1)! - fix the HTTP retry to never replay non-idempotent requests: POST/PATCH responses with 5xx/429 are no longer retried automatically (a 5xx can arrive after the server committed — retrying `placeOrder` could duplicate orders/charges). Read-only POST endpoints can opt back in via the new `RequestOptions.idempotent: true` flag. Numeric `Retry-After` waits are now capped at 8s. 5xx responses without a `Retry-After` header now back off exponentially instead of retrying immediately.

## 2.13.1

### Patch Changes

- [#121](https://github.com/viuteam/emporix-sdk/pull/121) [`2c58d04`](https://github.com/viuteam/emporix-sdk/commit/2c58d049aacdd7cc2e05e937ef6cb9fc50145c15) Thanks [@amnael1](https://github.com/amnael1)! - Fix customer order history showing no orders. `GET /order-v2/{tenant}/orders` returns a bare JSON array (the total count lives in the `X-Total-Count` header), but `OrdersService.listMine` cast that array straight to `PaginatedItems<Order>` without wrapping it — so at runtime `.items` was `undefined` and `useMyOrders` / `useMyOrdersInfinite` (and any order-history UI) rendered no orders even when the API returned them. `listMine` now normalizes the array into the shared `{ items, pageNumber, pageSize, hasNextPage }` envelope, like every other paginated service.

- [#123](https://github.com/viuteam/emporix-sdk/pull/123) [`3d2b047`](https://github.com/viuteam/emporix-sdk/commit/3d2b047c85f0218229c1236faf3e7ec467c2c209) Thanks [@amnael1](https://github.com/amnael1)! - Fix the reward-points balance/summary erroring for customers who have no points. `GET /reward-points/public/customer` (and `…/customer/summary`) is the correct Emporix endpoint, but it answers `404 "No reward points found"` for a signed-in customer who has never earned points — i.e. every customer without a completed order. `rewardPoints.getMyPoints` now maps that 404 to `0`, and `getMySummary` to an empty summary (`{ activePoints: 0, summary: { addedPointsList: [] } }`), so `useMyRewardPoints` / `useMyRewardPointsSummary` resolve cleanly instead of throwing. The admin lookups (`getCustomerPoints` / `getCustomerSummary`) still surface 404s, where a missing customer is a real error.

## 2.12.0

### Minor Changes

- [#116](https://github.com/viuteam/emporix-sdk/pull/116) [`5411502`](https://github.com/viuteam/emporix-sdk/commit/5411502fdde0737ad457812e28a86c505f938282) Thanks [@amnael1](https://github.com/amnael1)! - Add a runtime language switch. `client.setStorefrontContext({ language })` now sets an `Accept-Language` header on every read. React's `useSiteContext()` exposes `language` + `setLanguage(lang)` (modeled on `setCurrency`), persists the choice via `EmporixStorage` (`emporix.language`), mirrors it into the server session context, and keys localized reads (products, categories, segments, cart, shopping lists, orders) by language so the cache never serves stale-language text. A new `initialLanguage` provider prop seeds the active language.

## 2.11.0

### Minor Changes

- [#114](https://github.com/viuteam/emporix-sdk/pull/114) [`ac2b2c8`](https://github.com/viuteam/emporix-sdk/commit/ac2b2c890521da017b3ef44ff15bdf6b16d69bb9) Thanks [@amnael1](https://github.com/amnael1)! - feat: invoke Emporix cloud functions

  Adds `client.cloudFunctions.invoke<TRes, TReq>(functionId, { method?, path?,
body?, query?, headers? }, auth)` — a generic call to tenant cloud functions
  (`/cloud-functions/{tenant}/functions/{id}[/sub]`), with GET/POST/PUT/DELETE and
  service / customer / anonymous / raw auth (default anonymous). Adds the React
  hooks `useInvokeCloudFunction` (mutation, any method) and `useCloudFunction`
  (GET-style query with caching), both with auto-auth (customer-if-token-else-
  anonymous) and an optional override.

## 2.10.0

### Minor Changes

- [#112](https://github.com/viuteam/emporix-sdk/pull/112) [`1f87a9b`](https://github.com/viuteam/emporix-sdk/commit/1f87a9b54ddde591716eba7427e04573113b17f9) Thanks [@amnael1](https://github.com/amnael1)! - feat: runtime currency switching

  Adds `EmporixClient.setStorefrontContext({ currency, siteCode, targetLocation })`
  to re-bind the anonymous price context at runtime (invalidating the anon session
  so the next login re-mints with the new currency — covers the pre-cart guest
  case `sessionContext.patch` cannot). Adds `useSiteContext().setCurrency(code)`,
  which re-binds the context, clears the currency-bound guest cart, and PATCHes an
  existing server session context. The storefront-demo gains a currency dropdown
  populated from the active site's `availableCurrencies`.

  On reload, the site-context `currency` now seeds from the client's configured
  `context.currency` (instead of always deriving from the site default), so a
  persisted currency choice is respected.

## 2.9.0

### Minor Changes

- [#108](https://github.com/viuteam/emporix-sdk/pull/108) [`056cb62`](https://github.com/viuteam/emporix-sdk/commit/056cb622106fa5854ec9ebbee6e91c4820e62b29) Thanks [@amnael1](https://github.com/amnael1)! - feat(sdk): generate customer-management types from the real OpenAPI spec

  Replaces the hand-written customer-management mirror (B2B legal-entities /
  contact-assignments / locations) with codegen output from the vendored
  "Customer Management Service" spec, so Companies/Contacts/Locations return the
  real API shape. The `update` methods (and the matching `useUpdateCompany` /
  `useUpdateContactAssignment` / `useUpdateLocation` hooks) now type their PATCH
  body as `Partial<*Update>` to reflect the partial-update endpoint. `LegalEntity.id`
  and sibling ids are optional in the generated shape, matching the wire contract.

- [#109](https://github.com/viuteam/emporix-sdk/pull/109) [`f90e05b`](https://github.com/viuteam/emporix-sdk/commit/f90e05b97f6c022660bc36ac3656e2f48bf78e69) Thanks [@amnael1](https://github.com/amnael1)! - feat(sdk): generate IAM types, add group member mutations

  Replaces the last hand-written `generated/` mirror (`iam`) with codegen from the
  vendored "IAM Service" spec, so `customerGroups.listForCompany` returns the real
  group shape (`GroupsQueryDocument` — note: the wire uses `code`/`userType`, not
  the previously-mirrored `role`, which never existed on the API). Ships the
  previously-deferred group member mutations now that the endpoints are confirmed:
  `customerGroups.addMember` / `removeMember`, plus the `useAddGroupMember` /
  `useRemoveGroupMember` React hooks. No hand-written generated mirrors remain.

- [#106](https://github.com/viuteam/emporix-sdk/pull/106) [`04b95ea`](https://github.com/viuteam/emporix-sdk/commit/04b95eab1fbf6b09ca29b0e3a98605e5ef938c6c) Thanks [@amnael1](https://github.com/amnael1)! - feat(sdk): generate order-v2 types from the real OpenAPI spec

  Replaces the hand-written `order-v2` type mirror (which invented `items`,
  `{amount,currency}` totals and a top-level `orderNumber`) with codegen output
  from the vendored Emporix Order Service spec. `OrdersService` and
  `SalesOrdersService` now return the real API shape:
  - line items are `entries` (not `items`); each entry has `itemYrn`,
    `orderedAmount`/`amount`, and a nested `product`
  - `totalPrice`/`subTotalPrice` are numbers + a top-level `currency`; rich
    net/gross/tax lives in `calculatedPrice`
  - `orderNumber` is under `mixins.generalAttributes`
  - `SalesOrderPatch` is now `Partial<OrderUpdateDto>` (the real PATCH body)

  Public type surface: `Order`, `OrderEntry`, `OrderStatus`, `SalesOrder`,
  `Transition`, `SalesOrderPatch`. The unused fictional re-exports (`OrderItem`,
  `OrderMoney`, `OrderCustomer`, `OrderAddress`, `OrderPayment`, `OrderDelivery`,
  `OrderTaxLine`, `OrderMetadata`, `OrderTransition`) are removed — they had no
  runtime counterpart.

  `useReorder` now reads `entries` and re-adds each with its `itemYrn` + price row
  (`priceId`/amounts/currency) — the cart requires a price, so the previous
  `{ product: { id } }` body always failed; reorder now actually works.

- [#104](https://github.com/viuteam/emporix-sdk/pull/104) [`2bf31b2`](https://github.com/viuteam/emporix-sdk/commit/2bf31b230bc18c8ce17e3a41110e5b3edcb21f4c) Thanks [@amnael1](https://github.com/amnael1)! - feat(price): expose canonical `itemId` on price-match results + `productIdFromYrn`

  The deployed Emporix price API returns the matched item under `itemId` (with a
  localized `name`), but the OpenAPI spec/codegen type calls it `itemRef` — so the
  typed field was always `undefined` at runtime. `PriceService.match` /
  `matchByContext` / `matchByContextChunked` now expose `itemId` canonically and
  keep `itemRef` populated (mirrored from `itemId`) but `@deprecated`. Adds a
  `productIdFromYrn(yrn)` helper to extract a product id from an `itemYrn`.

- [#107](https://github.com/viuteam/emporix-sdk/pull/107) [`975290c`](https://github.com/viuteam/emporix-sdk/commit/975290c7bd6129754d82e131186cade633394836) Thanks [@amnael1](https://github.com/amnael1)! - feat(product): add searchByName free-text helper + useProductNameSearch

  `products.searchByName(term)` builds the Emporix `name:(~<term>)` regex filter
  (escaping metacharacters) and delegates to `search`, so consumers no longer
  hand-build the `q` DSL — a bare free-text term otherwise 400s with
  "No value for key …". Adds the `useProductNameSearch` React hook (disabled on
  empty/whitespace).

## 2.8.0

### Minor Changes

- [#98](https://github.com/viuteam/emporix-sdk/pull/98) [`108a724`](https://github.com/viuteam/emporix-sdk/commit/108a724f1d4342532ae8d575faa501d54d8c591f) Thanks [@amnael1](https://github.com/amnael1)! - Support partial cart-item updates. `client.carts.updateItem(cartId, itemId,
patch, auth, { partial: true })` now sends `?partial=true`, so a quantity-only
  change can be `{ quantity }` instead of a full item replace (which otherwise
  requires re-sending `itemYrn` + the `price` row). The React
  `useCartMutations().updateItem` mutation accepts an optional `partial` flag in
  its variables. Default behavior is unchanged.

## 2.7.0

### Minor Changes

- [#96](https://github.com/viuteam/emporix-sdk/pull/96) [`da1113a`](https://github.com/viuteam/emporix-sdk/commit/da1113a07f70dceb9f1cb732b28462ccb3671f4a) Thanks [@amnael1](https://github.com/amnael1)! - Fix and extend the Category service for catalogue + hierarchy browsing. Several
  methods targeted routes that don't exist on the deployed category service
  (verified against a live tenant):
  - **`categories.productsIn(...)`** requested a non-existent
    `/categories/{id}/products` route (always 404). It now resolves products via
    category **assignments** (`/categories/{id}/assignments` → keep `PRODUCT`
    refs → `/products/search`), preserving its `PaginatedItems<Product>` contract;
    categories with no products return an empty page instead of throwing.
  - **`categories.tree()`** pointed at a non-existent `/categories/{...}Tree`
    route. It now reads `/category-trees` and returns the catalogue's **root
    categories** (`Promise<Category[]>`) for top-level navigation. (Return type
    changed from the previous nested-node shape; the `rootId` argument is removed.)
  - **New `categories.subcategories(categoryId)`** (+ React `useSubcategories`):
    a category's direct child categories, resolved from `CATEGORY` assignment refs
    (mirrors `productsIn`). Returns `[]` when there are none.

  React `useCategoryTree()` now returns `Category[]` (root categories) and takes no
  `rootId`.

## 2.6.0

### Minor Changes

- [#92](https://github.com/viuteam/emporix-sdk/pull/92) [`45a2bd8`](https://github.com/viuteam/emporix-sdk/commit/45a2bd8d83cb46d775301790cb2efc60805efc90) Thanks [@amnael1](https://github.com/amnael1)! - Add opt-in reactive customer-token auto-refresh.

  Core: `EmporixClient.setCustomerTokenRefresher(refresher)` registers a
  single-flight `CustomerTokenRefresher`; on a `customer`-kind 401 the HTTP layer
  refreshes once and retries. Off by default — the customer token stays
  caller-owned.

  React: `EmporixProvider` gains `autoRefreshCustomerToken` and
  `onCustomerSessionExpired`. When enabled, a customer 401 is transparently
  refreshed via the stored refresh token (anonymous-authorized
  `GET /refreshauthtoken`) and the request is retried; B2B `legalEntityId` is
  preserved.

## 2.5.0

### Minor Changes

- [#87](https://github.com/viuteam/emporix-sdk/pull/87) [`83f5797`](https://github.com/viuteam/emporix-sdk/commit/83f5797ed8f38b63d67b9d392c0410be7a75997b) Thanks [@amnael1](https://github.com/amnael1)! - Add Emporix Approval Service bindings for B2B cart/quote approval workflows.

  Core `client.approvals` (`ApprovalService`): `listApprovals`, `getApproval`,
  `createApproval`, `updateApproval` (JSON-Patch approve/reject), `deleteApproval`,
  `checkPermitted`, and `searchApprovers`. Every endpoint is customer-token-only.

  React: `useApprovals`, `useApproval`, `useCreateApproval`, and `useUpdateApproval`
  (customer-only) for B2B approval self-service.

- [#83](https://github.com/viuteam/emporix-sdk/pull/83) [`1e473ad`](https://github.com/viuteam/emporix-sdk/commit/1e473ad0abe057450abcb777d0e29312cda37530) Thanks [@amnael1](https://github.com/amnael1)! - Add Emporix Catalog Management (`client.catalogs`) and Vendor Service
  (`client.vendors`) bindings: catalog CRUD (incl. catalogs-for-category) and
  vendor + vendor-location CRUD with vendor search. Server-side only — these use
  the service (clientCredentials) token.

- [#86](https://github.com/viuteam/emporix-sdk/pull/86) [`38c2510`](https://github.com/viuteam/emporix-sdk/commit/38c2510eefef3a69a941761d412163535cb6aad9) Thanks [@amnael1](https://github.com/amnael1)! - Add Emporix tenant-managed Customer Service bindings via `client.customerAdmin`:
  admin/seller CRUD over customer profiles (`listCustomers`, `searchCustomers`,
  `getCustomer`, `createCustomer`, `upsertCustomer`, `patchCustomer`,
  `deleteCustomer`) and their addresses (`listAddresses`, `getAddress`,
  `addAddress`, `upsertAddress`, `patchAddress`, `deleteAddress`, `addAddressTags`,
  `removeAddressTags`). Server-side only — distinct from the storefront
  `client.customers`.

- [#85](https://github.com/viuteam/emporix-sdk/pull/85) [`c874141`](https://github.com/viuteam/emporix-sdk/commit/c874141484731d383e5732b7b358062d412460e4) Thanks [@amnael1](https://github.com/amnael1)! - Add Emporix Pick-Pack Service bindings via `client.pickPack`: packlist orders
  (`listOrders`, `getOrder`, `updateOrder`, `finishOrder`, `listOrderCycles`),
  assignees (`addAssignee`, `removeAssignee`), packaging (`updatePackaging`),
  packing events (`createEvent`, `listEvents`), and recalculation jobs
  (`triggerRecalculation`, `getRecalculationJob`). Server-side only.

### Patch Changes

- [#88](https://github.com/viuteam/emporix-sdk/pull/88) [`ea9fc34`](https://github.com/viuteam/emporix-sdk/commit/ea9fc34c78e4620f3da2bf17040739f3dfd19669) Thanks [@amnael1](https://github.com/amnael1)! - Refresh package READMEs to reflect the full service and hook surface. The
  `@viu/emporix-sdk` README now lists all 44 services (grouped by area) and the
  correct published subpath exports; the `@viu/emporix-sdk-react` README documents
  every exported hook (orders, availability, coupon, reward-points, returns,
  approvals, shopping-lists, and the chunked price hook). Docs-only — no API
  changes.

## 2.4.0

### Minor Changes

- [#82](https://github.com/viuteam/emporix-sdk/pull/82) [`4b55f1d`](https://github.com/viuteam/emporix-sdk/commit/4b55f1d3cd482b6a233a6e7a1ac7de063de89526) Thanks [@amnael1](https://github.com/amnael1)! - Add Emporix SEPA Export (`client.sepaExport`), Indexing (`client.indexing`), and
  Unit Handling (`client.units`) bindings: SEPA export jobs + file retrieval;
  search-index provider configurations + reindex; unit CRUD, unit types, and
  conversion commands. Server-side only — these use the service (clientCredentials)
  token.

- [#77](https://github.com/viuteam/emporix-sdk/pull/77) [`7adb16a`](https://github.com/viuteam/emporix-sdk/commit/7adb16a289f8480bb87f8d9d271b8502c957239c) Thanks [@amnael1](https://github.com/amnael1)! - Add Emporix Brand and Label Service bindings via `client.brands` and
  `client.labels`: full CRUD (`listBrands`/`getBrand`/`createBrand`/`updateBrand`/
  `patchBrand`/`deleteBrand` and the label equivalents). Server-side only — these
  use the service (clientCredentials) token; brand reads also work anonymously.

- [#78](https://github.com/viuteam/emporix-sdk/pull/78) [`83ed37e`](https://github.com/viuteam/emporix-sdk/commit/83ed37e4e38767358e06208e64cb87004b261744) Thanks [@amnael1](https://github.com/amnael1)! - Add Emporix Country and Currency Service bindings via `client.countries`
  (countries + regions: `listCountries`/`getCountry`/`patchCountry`/`listRegions`/
  `getRegion`) and `client.currencies` (currencies + exchange rates: full CRUD on
  both). Server-side only — these use the service (clientCredentials) token.

- [#75](https://github.com/viuteam/emporix-sdk/pull/75) [`2174664`](https://github.com/viuteam/emporix-sdk/commit/21746648f890410a46c95c37b218bb6bbc98ebe7) Thanks [@amnael1](https://github.com/amnael1)! - Add Emporix Coupon Service bindings via `client.coupons`: coupon CRUD
  (`listCoupons`, `getCoupon`, `createCoupon`, `updateCoupon`, `patchCoupon`,
  `deleteCoupon`), validation (`validateCoupon`), redemptions (`listRedemptions`,
  `redeemCoupon`, `getRedemption`, `deleteRedemption`), and referral coupons
  (`getReferralCoupon`, `createReferralCoupon`). Methods default to the service
  token and are auth-overridable. Adds React hooks `useValidateCoupon` and
  `useRedeemCoupon` for storefront validate/redeem (browser auth context).

- [#81](https://github.com/viuteam/emporix-sdk/pull/81) [`f626ef6`](https://github.com/viuteam/emporix-sdk/commit/f626ef6ef25c6856c027402b854bf81bb14fe864) Thanks [@amnael1](https://github.com/amnael1)! - Add Emporix Returns Service bindings via `client.returns`: CRUD over returns
  (`listReturns`, `getReturn`, `createReturn`, `updateReturn`, `patchReturn`,
  `deleteReturn`). Methods default to the service token and are auth-overridable;
  `patchReturn` takes a JSON-Patch op-array. Adds React hooks `useMyReturns`,
  `useReturn`, and `useCreateReturn` for customer self-service (browser customer
  token).

- [#76](https://github.com/viuteam/emporix-sdk/pull/76) [`2dddd6a`](https://github.com/viuteam/emporix-sdk/commit/2dddd6a213fa9d70bbaf0acc790eee51a7d813a8) Thanks [@amnael1](https://github.com/amnael1)! - Add Emporix Reward Points Service bindings via `client.rewardPoints`: admin
  customer-points management (`listAllSummaries`, `getCustomerPoints`,
  `createCustomerPoints`, `deleteCustomerPoints`, `getCustomerSummary`,
  `addPoints`, `redeemPoints`), the signed-in customer's own points
  (`getMyPoints`, `getMySummary`, `redeemMyPoints` → coupon code), and redeem
  options (`listRedeemOptions`, `createRedeemOption`, `updateRedeemOption`,
  `deleteRedeemOption`). Admin methods default to the service token; the
  `/public/*` methods require a customer token. Adds React hooks
  `useMyRewardPoints`, `useMyRewardPointsSummary`, `useRedeemRewardPoints` and
  `useRedeemOptions`.

- [#80](https://github.com/viuteam/emporix-sdk/pull/80) [`46ddb50`](https://github.com/viuteam/emporix-sdk/commit/46ddb50f7fcf3f59269e60b5535db533cf984949) Thanks [@amnael1](https://github.com/amnael1)! - Extend `client.shipping` with delivery scheduling: delivery windows
  (`getAreaDeliveryWindows`, `getCartDeliveryWindows`, `incrementDeliveryWindowCounter`,
  `validateDeliveryWindow`), delivery times (`listDeliveryTimes`, `getDeliveryTime`,
  `createDeliveryTime`, `createDeliveryTimesBulk`, `updateDeliveryTime`,
  `patchDeliveryTime`, `deleteDeliveryTime`), delivery time slots (`listSlots`,
  `getSlot`, `createSlot`, `updateSlot`, `patchSlot`, `deleteSlot`, `deleteAllSlots`),
  and delivery cycles (`generateDeliveryCycle`). Server-side only.

- [#79](https://github.com/viuteam/emporix-sdk/pull/79) [`04b138e`](https://github.com/viuteam/emporix-sdk/commit/04b138e4c3df69786e9bcdccc9a6ce0f1c329214) Thanks [@amnael1](https://github.com/amnael1)! - Add Emporix Shipping Service bindings (Phase 1 — config) via `client.shipping`:
  sites (`findSites`), zones and methods (full CRUD), cost/quote (`quote`,
  `quoteMinimum`, `quoteSlot`), shipping groups, and customer-group relations.
  Server-side only — these use the service (clientCredentials) token. Delivery
  scheduling (windows, times, slots, cycles) is not yet bound.

- [#73](https://github.com/viuteam/emporix-sdk/pull/73) [`ce6d3c1`](https://github.com/viuteam/emporix-sdk/commit/ce6d3c1d096e5f521b3d59dad9fb266fd1d743a3) Thanks [@amnael1](https://github.com/amnael1)! - Add Emporix Tax Service bindings via `client.taxes`: CRUD over per-location tax
  configurations (`listTaxConfigs`, `getTaxConfig`, `createTaxConfig`,
  `updateTaxConfig`, `deleteTaxConfig`) and net/gross tax calculation
  (`calculateTax`). Server-side only — these use the service (clientCredentials)
  token and must not be called from a browser.

## 2.3.0

### Minor Changes

- [#67](https://github.com/viuteam/emporix-sdk/pull/67) [`97cda33`](https://github.com/viuteam/emporix-sdk/commit/97cda33466e633836c046ae00dbdde051352c5f2) Thanks [@amnael1](https://github.com/amnael1)! - Add AI RAG Indexer binding: `client.ragIndexer` exposes `ragMetadata()` and
  `filterMetadata()` to discover the indexed embedding / filterable fields, plus
  `reindex()` to trigger a full asynchronous index rebuild. Server-side only —
  these use the service (clientCredentials) token (`ai.agent_read` /
  `ai.agent_manage`) and must not be called from a browser.

- [#72](https://github.com/viuteam/emporix-sdk/pull/72) [`7a3885a`](https://github.com/viuteam/emporix-sdk/commit/7a3885ad58d20c8e5726fa9e976a68588ea90e43) Thanks [@amnael1](https://github.com/amnael1)! - Add Emporix AI Service bindings via `client.ai`: text generation
  (`generateText`), chat completions (`complete`), agent CRUD (`listAgents`,
  `getAgent`, `upsertAgent`, `patchAgent`, `deleteAgent`, `searchAgents`), and
  synchronous / asynchronous agentic chat (`chat`, `chatAsync`). Server-side only
  — these use the service (clientCredentials) token and must not be called from a
  browser; both chat endpoints return arrays. Templates, import/export,
  logs/sessions and tokens are not yet bound.

- [#69](https://github.com/viuteam/emporix-sdk/pull/69) [`c79332e`](https://github.com/viuteam/emporix-sdk/commit/c79332e80f478d2d5d71d820279eda74d55eb08c) Thanks [@amnael1](https://github.com/amnael1)! - Add Fee Service bindings: `client.fees` provides CRUD over fee definitions
  (`list`/`get`/`create`/`update`/`delete`) plus item- and product-fee mappings
  (`listItemFees`/`getItemFees`/`createItemFee`/`setItemFees`/`deleteItemFees`/
  `searchItemFees`, `getProductFees`/`setProductFees`/`deleteProductFees`).
  Server-side only — these use the service (clientCredentials) token and must not
  be called from a browser.

- [#71](https://github.com/viuteam/emporix-sdk/pull/71) [`993a563`](https://github.com/viuteam/emporix-sdk/commit/993a563a2d6e20dcf218a1367c3f2dd5e77cce0e) Thanks [@amnael1](https://github.com/amnael1)! - Add Schema Service bindings: `client.schemas` provides CRUD over schemas
  (`listSchemas`/`getSchema`/`createSchema`/`updateSchema`/`deleteSchema`) plus
  `validateSchemaFile`, entity types (`listTypes`/`setSchemaTypes`), custom
  entities (`listCustomEntities`/`getCustomEntity`/`createCustomEntity`/
  `updateCustomEntity`/`deleteCustomEntity`), and custom instances
  (`listInstances`/`getInstance`/`createInstance`/`replaceInstance`/
  `patchInstance`/`deleteInstance`/`searchInstances`). Server-side only — these
  use the service (clientCredentials) token and must not be called from a
  browser. References, export/import and bulk instance ops are not yet exposed.

- [#68](https://github.com/viuteam/emporix-sdk/pull/68) [`9861d87`](https://github.com/viuteam/emporix-sdk/commit/9861d87a2e672400e2eaf1c90052bef62641c93f) Thanks [@amnael1](https://github.com/amnael1)! - Add Sequential ID Service binding: `client.sequentialIds` provides sequence
  schema admin (`listSchemas`/`getSchema`/`createSchema`/`deleteSchema`/
  `setActiveSchema`/`listSchemasByType`) and id generation (`nextId`,
  `nextIdsBatch`). Server-side only — these use the service (clientCredentials)
  token and must not be called from a browser.

- [#65](https://github.com/viuteam/emporix-sdk/pull/65) [`dca34d0`](https://github.com/viuteam/emporix-sdk/commit/dca34d044e54c305ea2a310ba349dc800ced331a) Thanks [@amnael1](https://github.com/amnael1)! - Add Shopping List bindings: `client.shoppingLists` (per-customer named lists —
  list/create/replace/delete plus read-modify-write item helpers, last-write-wins)
  and React hooks (`useShoppingLists`, `useCreateShoppingList`, `useAddToShoppingList`,
  `useRemoveFromShoppingList`, `useSetShoppingListItemQuantity`, `useDeleteShoppingList`).

- [#70](https://github.com/viuteam/emporix-sdk/pull/70) [`21063a1`](https://github.com/viuteam/emporix-sdk/commit/21063a161029c9ea22278c08f89b59a36cb7fb01) Thanks [@amnael1](https://github.com/amnael1)! - Add Webhook Service bindings: `client.webhooks` provides the event-subscription
  catalog + batch toggle (`listEventSubscriptions` / `updateEventSubscriptions`),
  delivery-config CRUD (`listConfigs` / `getConfig` / `createConfig` /
  `replaceConfig` / `patchConfig` / `deleteConfig`), `getStatistics`, and
  `getDashboardAccess`. `updateEventSubscriptions` returns the HTTP-207 per-item
  result array so callers can handle partial failures; `patchConfig` takes the
  op-based (`UPSERT`/`REMOVE`) update array. Server-side only — these use the
  service (clientCredentials) token and must not be called from a browser.

## 2.2.0

### Minor Changes

- [#61](https://github.com/viuteam/emporix-sdk/pull/61) [`4a869c9`](https://github.com/viuteam/emporix-sdk/commit/4a869c9aa60cce99b79b41b8470af367e1b4e249) Thanks [@amnael1](https://github.com/amnael1)! - Add Configuration Service bindings: `client.tenantConfig` and
  `client.clientConfig` provide full CRUD (`list`/`get`/`create`/`update`/`delete`)
  over tenant-wide and per-client configuration. Server-side only — these use the
  service (clientCredentials) token and must not be called from a browser.

- [#63](https://github.com/viuteam/emporix-sdk/pull/63) [`bb2ce4f`](https://github.com/viuteam/emporix-sdk/commit/bb2ce4f891e50e07cee02e03340d2abe1133fdc0) Thanks [@amnael1](https://github.com/amnael1)! - Add `products.searchByCodes(codes, { chunkSize? })` — bulk-fetch products by
  `code` via `POST /products/search` (`q="code:(…)"`), chunked at 100, analogous
  to `searchByIds`. Codes with query-delimiter characters are dropped with a
  warning. Adds the `useProductsByCodes` React hook (30s stale-time).

### Patch Changes

- [#62](https://github.com/viuteam/emporix-sdk/pull/62) [`9747445`](https://github.com/viuteam/emporix-sdk/commit/9747445c13a27319462755c5333c9ae0a4741e68) Thanks [@amnael1](https://github.com/amnael1)! - Report the real package version as `sdkVersion` on every log line instead of the
  hardcoded `0.0.0` placeholder. The version is now read from `package.json` and
  inlined at build time (browser-safe, no runtime filesystem access).

## 2.1.0

### Minor Changes

- [#56](https://github.com/viuteam/emporix-sdk/pull/56) [`939a1b0`](https://github.com/viuteam/emporix-sdk/commit/939a1b0a24063db38545dc81f88c319f93e81833) Thanks [@amnael1](https://github.com/amnael1)! - Add AvailabilityService (`client.availability.get` / `.getMany`) and the
  `useAvailability` / `useAvailabilities` React hooks for site-aware product
  availability. `getMany` uses the batch `POST .../search` endpoint and returns
  results in input order; an opt-in `defaultAvailableOnNotFound` treats products
  with no stock record as available. New `@viu/emporix-sdk/availability` subpath export.

- [#58](https://github.com/viuteam/emporix-sdk/pull/58) [`caaff28`](https://github.com/viuteam/emporix-sdk/commit/caaff2819e64cf42e4c58dfe4c04fa994312f901) Thanks [@amnael1](https://github.com/amnael1)! - Add PriceService.matchByContextChunked and the useMatchPricesChunked React hook:
  split large match-prices-by-context requests into bounded-concurrency chunks
  (default 50 items, 4 in flight) with per-chunk error handling.

- [#57](https://github.com/viuteam/emporix-sdk/pull/57) [`0302ea3`](https://github.com/viuteam/emporix-sdk/commit/0302ea368e6d7feb0a064aac71a6f5314380deb3) Thanks [@amnael1](https://github.com/amnael1)! - Add ProductService.listVariantChildren / listVariantChildrenAll and the
  useVariantChildren React hook to resolve the VARIANT children of a
  PARENT_VARIANT product without hand-building the search query.

## 2.0.0

### Major Changes

- [#52](https://github.com/viuteam/emporix-sdk/pull/52) [`26640fe`](https://github.com/viuteam/emporix-sdk/commit/26640fe281083e6ce0475a547e292ac82ba7d9bf) Thanks [@amnael1](https://github.com/amnael1)! - Add `client.media.download(assetId, auth?)` for retrieving asset content via `GET /media/{tenant}/assets/{id}/download`. Returns a discriminated union:
  - `{ kind: "redirect", url }` for `PUBLIC` assets — the SDK captures the server's 30x `Location` header so the caller can redirect the user to the storage URL without proxying bytes.
  - `{ kind: "bytes", data, etag?, contentType? }` for `PRIVATE` assets — the SDK returns the response body as an `ArrayBuffer`. When the server uses the OpenAPI-documented `text/plain` + base64 wire format, the SDK decodes it transparently; binary content types are passed through.

  Also adds a low-level `HttpClient.requestRaw` escape hatch (used internally by `download`) for endpoints whose responses are not JSON. Auth resolution + timeout + logging are applied; the retry-on-5xx and 401-reauth-once paths from `request` are intentionally skipped (callers of `requestRaw` handle their own response shape).

  Browser note: `download()` uses `redirect: "manual"` so it can observe `PUBLIC` redirect URLs. In Node this works as documented; in a browser the redirect `Location` is hidden by the fetch spec — there, `PUBLIC` downloads will surface as an error. Browser code should use the asset's `url` field (for `LINK` assets) or render `PUBLIC` `BLOB` assets via the storage URL directly.

  **Breaking — `media.list()`** now returns `PaginatedItems<Asset>` instead of `Asset[]`. Callers must read `.items` for the array. The new shape includes `pageNumber`, `pageSize`, and the standard `hasNextPage` heuristic so paginated listings behave like every other list endpoint in the SDK. The previous shape silently truncated at the server-default page size (60); the new shape makes pagination explicit.

  ```ts
  // before
  const assets = await client.media.list(); // Asset[], page 1 only
  // after
  const { items, hasNextPage } = await client.media.list({ pageSize: 100 });
  ```

  `client.media.listForProduct(productId)` shares the same envelope change.

  **Breaking — `media.update()`** now takes a discriminated input matching `create()`:

  ```ts
  // before
  await client.media.update(id, patch);
  // after — JSON path (refIds, details, url, metadata)
  await client.media.update(id, { kind: "json", body: patch });
  // after — BLOB file-replacement (multipart, up to 10MB)
  await client.media.update(id, { kind: "blob", file, body });
  ```

  The previous signature only supported the JSON path; the new BLOB path closes the gap where re-uploading bytes required `remove` + `create` (and lost the asset id). A new `client.media.replaceFile(assetId, { file, access, ... })` sugar wraps the common case.

  New named type exports: `AssetUpdateBlobInput`, `AssetUpdateLinkInput`, `ListAssetsQuery`.

## 1.0.0

### Minor Changes

- [#15](https://github.com/viuteam/emporix-sdk/pull/15) [`5c51a58`](https://github.com/viuteam/emporix-sdk/commit/5c51a58313c63cb7a9e34a4c5e6dc1da2017a827) Thanks [@amnael1](https://github.com/amnael1)! - `credentials.storefront.context` (`{ currency, siteCode, targetLocation }`)
  is now sent at anonymous-login so `prices.matchByContext` resolves prices
  from the session. Adds the `useMatchPrices` React hook. The next-app-router
  and vite-spa examples now include an anonymous guest-checkout flow.

  BREAKING: `CartService.create` now returns the generated `CartCreated`
  (`{ cartId, yrn }`) — the actual create-endpoint response — instead of the
  `Cart` GET model. Read `cart.cartId` (not `cart.id`) from the result.

- [#17](https://github.com/viuteam/emporix-sdk/pull/17) [`bda4bd8`](https://github.com/viuteam/emporix-sdk/commit/bda4bd8b5b02e2b397f3a0751a45ac204b8572a0) Thanks [@amnael1](https://github.com/amnael1)! - Anonymous session continuity: when the cached anonymous access token is
  expired (or rejected with a 401), the SDK now **refreshes via the refresh
  token first**, preserving the same `sessionId` (and thus the anonymous
  cart), and only falls back to a brand-new anonymous login if the refresh
  fails. Previously every expiry/401 started a fresh session with a new
  `sessionId`. Adds an optional `expireAnonymous()` to the `TokenProvider`
  interface (used by the HTTP 401 path to keep the refresh token);
  `invalidateAnonymous()` still performs a full reset.

- [#47](https://github.com/viuteam/emporix-sdk/pull/47) [`765c54e`](https://github.com/viuteam/emporix-sdk/commit/765c54e8fd61e33cb0d4cc241415e9c56f45c729) Thanks [@amnael1](https://github.com/amnael1)! - B2B foundation:
  - New `client.companies` / `client.contacts` / `client.locations` services over Customer Management (legal entities, contact assignments, locations).
  - New `client.customerGroups` (read-only) over IAM (groups filtered by `b2b.legalEntityId`).
  - New `EmporixInsufficientScopeError` subclass of `EmporixForbiddenError`, surfaced from 403 responses that carry a `missing scope: …` detail. Carries `requiredScope`.
  - New `ServiceName` entries `"customer-management"` and `"iam"` for logger scoping.

  No breaking changes. Existing `cart.getCurrent({ legalEntityId })` and `customer.refresh({ legalEntityId })` are now exercised in tests.

- [#49](https://github.com/viuteam/emporix-sdk/pull/49) [`f18e55c`](https://github.com/viuteam/emporix-sdk/commit/f18e55ceec9784e5aad6e95604e016c5858f9bdc) Thanks [@amnael1](https://github.com/amnael1)! - Expose B2B services as subpath imports: `@viu/emporix-sdk/companies`, `@viu/emporix-sdk/contacts`, `@viu/emporix-sdk/locations`, `@viu/emporix-sdk/customer-groups`. The services were already reachable via the package root; this adds the matching `exports` entries and `tsup` build artefacts so tree-shaking and selective imports work the same way they do for `./customer`, `./product`, etc.

- [#5](https://github.com/viuteam/emporix-sdk/pull/5) [`f312f22`](https://github.com/viuteam/emporix-sdk/commit/f312f228f17686476ce3458436758bd05af63fce) Thanks [@amnael1](https://github.com/amnael1)! - Fix two defects found by live verification of the example apps:
  - **Browser compatibility:** the SDK read `process.env` unconditionally
    (logger level resolution + console-logger `pretty` default), throwing
    `ReferenceError: process is not defined` in browsers/edge runtimes. All env
    reads now go through a guarded `readEnv()`. The SDK works in the browser
    without `logger: false`.
  - **`credentials.backend` is now optional.** Storefront/SPA apps use only
    `credentials.storefront` (anonymous) plus caller-supplied customer tokens and
    must never ship a backend secret. `validateConfig` no longer requires
    `backend`; a missing backend is enforced lazily (clear `EmporixAuthError`)
    only when a `service` AuthContext is actually used.

- [#7](https://github.com/viuteam/emporix-sdk/pull/7) [`959c6cc`](https://github.com/viuteam/emporix-sdk/commit/959c6cc3d0a4a37870cb72d5573b6fde9b0faa65) Thanks [@amnael1](https://github.com/amnael1)! - Add CheckoutService (cart and quote checkout, `saas-token` header, guest
  checkout, `siteCode`) and PaymentGatewayService (frontend payment modes,
  post-checkout deferred authorize). HttpClient gains per-request `headers`;
  `saas-token` is added to the redaction floor. New subpath exports
  `@viu/emporix-sdk/checkout` and `@viu/emporix-sdk/payment`.

- [#2](https://github.com/viuteam/emporix-sdk/pull/2) [`d52bcdc`](https://github.com/viuteam/emporix-sdk/commit/d52bcdc79433daaf143586264a409cad57e404a1) Thanks [@amnael1](https://github.com/amnael1)! - Add OpenAPI codegen pipeline and the Customer, Product, Category and Cart
  service facades plus the EmporixClient aggregator with per-service subpath
  exports.

- [#26](https://github.com/viuteam/emporix-sdk/pull/26) [`18e34a0`](https://github.com/viuteam/emporix-sdk/commit/18e34a03cbf4fbfe15a7e4995228bb5268b0e2ee) Thanks [@amnael1](https://github.com/amnael1)! - Customer-cart onboarding on login. After `useCustomerSession.login()` (or the SSO flows `socialLogin` / `exchangeToken`) succeeds, the SDK now automatically loads (or creates) the customer's open Emporix cart for the configured `siteCode` and merges any guest cart into it. The resulting `cartId` is written into `EmporixStorage`, so the UI sees the cart immediately.

  **SDK (`@viu/emporix-sdk`)**
  - `EmporixClient.config` is now a public read-only field, so hosts can read static settings such as `storefront.context.siteCode` without re-plumbing.
  - **BREAKING:** `CartService.getCurrent(auth)` is now `getCurrent(auth, { siteCode, type?, legalEntityId?, create? })`. `siteCode` is required per the Emporix spec. Returns `null` on 404; with `create: true`, Emporix creates a new cart if none matches.
  - **BREAKING / fix:** `CartService.merge(anonymousCartId, auth)` is now `merge(customerCartId, anonymousCartIds: string[], auth)`. The old signature put the wrong cart-id in the path and sent an empty body — it never actually worked against Emporix. The new signature matches the documented contract (`POST /cart/{tenant}/carts/{customerCartId}/merge` with body `{ carts: […] }`).

  **React (`@viu/emporix-sdk-react`)**
  - `useCustomerSession.login()`, `socialLogin()`, and `exchangeToken()` now run a best-effort cart-onboarding step: `client.carts.getCurrent({ siteCode, create: true })` to load (or create) the customer cart, then `client.carts.merge(customerCartId, [anonCartId])` if a guest `cartId` was in storage, and finally `storage.setCartId(customerCartId)`. Failures are swallowed so login never blocks on cart trouble. Skipped silently if no `storefront.context.siteCode` is configured.

  **Migration**

  ```ts
  // SDK getCurrent:
  - const cart = await client.carts.getCurrent(auth.customer(token));
  + const cart = await client.carts.getCurrent(auth.customer(token), { siteCode: "main" });

  // SDK merge:
  - await client.carts.merge(anonCartId, auth.customer(token));
  + await client.carts.merge(customerCartId, [anonCartId], auth.customer(token));
  ```

  React consumers do not need to change anything — the new behavior kicks in automatically as long as the client's `storefront.context.siteCode` is set (the vite-spa Example already does).

- [#19](https://github.com/viuteam/emporix-sdk/pull/19) [`2f823b8`](https://github.com/viuteam/emporix-sdk/commit/2f823b8eb72eca17863757c3f6ccbf3e76442ee3) Thanks [@amnael1](https://github.com/amnael1)! - Add real customer logout. `customers.logout(auth)` calls
  `GET /customer/{tenant}/logout?accessToken=…` authorized with the customer
  token, invalidating it server-side (204). `useCustomerSession().logout()` is
  now async: it performs the server logout best-effort (ignoring failures, e.g.
  an already-expired token) and then clears the local session. The token is
  sent only as a query param the SDK never logs (the logger uses the path, not
  the full URL).

- [#22](https://github.com/viuteam/emporix-sdk/pull/22) [`5770532`](https://github.com/viuteam/emporix-sdk/commit/57705327b4d58b1ac410ee958f85ae858a6c862d) Thanks [@amnael1](https://github.com/amnael1)! - Add `SegmentService` (storefront reads only): `list`, `get`, `listItems`,
  `listSegmentItems`, `getCategoryTree`, plus the hydrate helpers
  `listMyProductIds` / `listMyCategoryIds` / `listMyProducts` /
  `listMyCategories` that map segment-item ids to real `Product` /
  `Category` objects via parallel `products.get` / `categories.get` calls.
  All methods require a customer/raw `AuthContext` and use the shared
  `requireCustomer` guard (also adopted by `customer.ts` and `payment.ts`).

  React adds three lightweight hooks: `useMySegments`, `useMySegmentItems`,
  `useMySegmentCategoryTree`. Each reads the customer token from the
  storage and is `enabled: false` when there is no token (no network call
  for guests). Exposed on the `@viu/emporix-sdk/segment` subpath.

- [#18](https://github.com/viuteam/emporix-sdk/pull/18) [`7da7b21`](https://github.com/viuteam/emporix-sdk/commit/7da7b217912782ba5d9b3f1e959d78d70c32c4ba) Thanks [@amnael1](https://github.com/amnael1)! - Add customer token refresh. `customers.refresh({ refreshToken, saasToken?,
legalEntityId? }, auth?)` calls `GET /customer/{tenant}/refreshauthtoken`
  (authorized with an anonymous token, default), returning a new
  `CustomerSession` with the **same `sessionId`**. The refresh endpoint does
  not return a `saas_token`, so the original is carried forward via the
  `saasToken` input. `useCustomerSession` now captures the refresh/saas tokens
  at `login`, exposes `refreshToken`, and adds a `refreshSession()` action
  that exchanges the refresh token and updates the stored customer token.

- [#1](https://github.com/viuteam/emporix-sdk/pull/1) [`4cdfa41`](https://github.com/viuteam/emporix-sdk/commit/4cdfa411ffb48b79510b0e98faa9ddf6f8c0600c) Thanks [@amnael1](https://github.com/amnael1)! - Add SDK foundation: config validation, EmporixError hierarchy, per-service
  logger with redaction, TokenProvider (service + anonymous with
  sessionId-preserving refresh), and the HTTP client with retry and 401
  asymmetry.

- [#14](https://github.com/viuteam/emporix-sdk/pull/14) [`4d87f11`](https://github.com/viuteam/emporix-sdk/commit/4d87f11a022996a49dad04af1404394cdd60804f) Thanks [@amnael1](https://github.com/amnael1)! - BREAKING: every service request body now uses the generated OpenAPI request
  type. `carts.create` takes `CreateCart`, `carts.addItem` takes
  `CartItemRequest` (now requires `product`/`quantity`/`price`),
  `carts.updateItem` takes `UpdateCartItem`, `checkout.placeOrder` takes
  `RequestCheckout`, `checkout.placeOrderFromQuote` takes
  `RequestFromQuoteCheckout`, `payments.authorize` takes
  `AuthorizePaymentRequest` (`{ order: { id }, … }`),
  `customers.changePassword` takes `{ currentPassword, newPassword }`,
  `customers.confirmPasswordReset` takes `{ token, password }`,
  `customers.signup`/`update`/`addresses.*` take the generated DTOs. All
  ergonomic input wrappers and input transformations are removed — callers
  send the exact wire shape. `useCartMutations.addItem`/`updateItem` mutation
  variables change accordingly. `CustomerService.login` keeps its literal
  `{ email, password }` input and snake_case `CustomerSession` response (no
  generated request type exists for it).

- [#12](https://github.com/viuteam/emporix-sdk/pull/12) [`693c58c`](https://github.com/viuteam/emporix-sdk/commit/693c58c5d148eeef746aef18a8f5dada766d7041) Thanks [@amnael1](https://github.com/amnael1)! - BREAKING: service methods now return the generated OpenAPI types instead of
  the simplified hand-rolled interfaces. `Product`, `Cart`, `Category`,
  `CategoryNode`, `CheckoutResult`, `PaymentMode`, `Customer`, and `Address`
  are now type aliases over the generated schemas, so all API fields are typed
  and available. Code that relied on the previous narrow shapes may need to
  adjust field access — notably `Customer.email` is now `Customer.contactEmail`,
  `Cart.items` / `Product.id` are optional per the spec, and product `name` is a
  localized object. `CustomerService.login` / `CustomerSession` are unchanged
  (the login wire is snake_case; camelCase is deprecated).

- [#6](https://github.com/viuteam/emporix-sdk/pull/6) [`59b78a8`](https://github.com/viuteam/emporix-sdk/commit/59b78a87d1dd56568e068c0a7738223714cb086b) Thanks [@amnael1](https://github.com/amnael1)! - Fix `CustomerService.login` wire mapping. The Emporix `CustomerToken` response
  is snake_case (`access_token`, `saas_token`, `refresh_token`, `session_id`,
  `expires_in`); the camelCase variants are deprecated in the spec and may be
  absent on real tenants, so the previous camelCase-only mapping returned
  `undefined` tokens. Mapping is now snake_case-first with a camelCase fallback,
  and `CustomerSession` additionally exposes `sessionId` and `expiresIn`. The
  `saasToken` (JWT) is documented as required for the checkout `saas-token`
  header.

- [#21](https://github.com/viuteam/emporix-sdk/pull/21) [`877c2ab`](https://github.com/viuteam/emporix-sdk/commit/877c2abf791a6d67d438849cd800d5704ec486cb) Thanks [@amnael1](https://github.com/amnael1)! - Add `MediaService`. `client.media.create({ kind: "blob" | "link", ... })`
  posts to `POST /media/{tenant}/assets` (multipart for BLOB, JSON for LINK);
  convenience helpers `uploadFile`, `link`, `attachToProduct`,
  `detachFromProduct`, `listForProduct` wrap the common product-attachment
  flows. `HttpClient` now passes `FormData` bodies through `fetch` verbatim
  (no Content-Type/JSON-stringify). React adds a thin `useProductMedia(id)`
  hook that reads `productMedia` from the existing product query (no
  service-token call in the browser).

  BREAKING: `ProductService.media` is removed — it called a path
  (`/product/{tenant}/products/{id}/media`) that does not exist in the
  Emporix Product API. Migrate to `client.media.listForProduct(productId)`
  (admin/server) or read `product.productMedia` from `client.products.get`
  (storefront).

- [#37](https://github.com/viuteam/emporix-sdk/pull/37) [`380796a`](https://github.com/viuteam/emporix-sdk/commit/380796a53d9543b379b21eb414e3ebc5586e55f8) Thanks [@amnael1](https://github.com/amnael1)! - Add Site Settings Service binding — first stage of multi-site foundation.

  **SDK**
  - `client.sites.list()` — list active sites for the tenant.
  - `client.sites.get(code)` — retrieve one site by code.
  - `client.sites.current()` — convenience for the `default: true` site.
  - New `Site` type mirroring the `SiteDto` schema (code, name, active,
    default, currency, languages, homeBase, shipToCountries, …).

  **React**
  - `useSites()` — list active sites.
  - `useDefaultSite()` — the default site.

  No breaking changes. The active-site runtime context (provider state,
  `setSite`, cache-key migration) follows in MS-2.

- [#39](https://github.com/viuteam/emporix-sdk/pull/39) [`141521c`](https://github.com/viuteam/emporix-sdk/commit/141521c91f88171006067255294a45b9fdc01a43) Thanks [@amnael1](https://github.com/amnael1)! - Multi-site MS-3: server-side session-context sync.

  **SDK**
  - `client.sessionContext.get()` — `GET /session-context/{tenant}/me/context`.
    Returns `null` (not throws) when the server returns 404 — i.e. when the
    user has not created a cart yet and no session-context exists.
  - `client.sessionContext.patch(input)` — `PATCH /session-context/{tenant}/me/context`
    with optimistic-locking. Looks up `metadata.version` via GET first
    unless caller provides one. Returns `true` when applied, `false` when
    there is no session context yet (404 on the GET → patch skipped).
  - New `SessionContext` and `SessionContextPatch` types.

  **React**
  - `setSite()` is now async. It flips local state + storage + cart-id
    - cache-invalidation synchronously (optimistic UI), then PATCHes the
      server. Skips the PATCH when no session exists yet (404 on GET).
  - `useSiteContext()` gains `isSwitching: boolean` and
    `switchError: Error | null`. The optimistic state is NOT rolled back
    on PATCH failure — surface the error in UI; the next user interaction
    retries.

  No breaking changes. Existing call sites continue to work — `setSite("X")`
  without `await` still flips the UI; awaiting it blocks until the
  server-side sync completes.

- [#42](https://github.com/viuteam/emporix-sdk/pull/42) [`8d22fb8`](https://github.com/viuteam/emporix-sdk/commit/8d22fb8d4cdf5e2ddeba7273ffe4b41a1630d463) Thanks [@amnael1](https://github.com/amnael1)! - Add opt-in telemetry channel for observability + ops-tuning.

  **SDK (additive)**
  - `TokenProvider.onRefresh(listener)` — optional subscription to
    token-refresh events. `DefaultTokenProvider` implements it (anonymous
    refresh path).

  **React (additive)**
  - `<EmporixProvider onTelemetry={fn}>` — receives a typed event stream
    covering cache hit/miss, refetches, errors, mutations, auth refreshes,
    and storage writes.
  - `useEmporixTelemetry()` — returns `{ emit }` for consumer-side custom
    events on the same channel.
  - `EmporixStorage.subscribeAll(listener)` — optional subscription to all
    storage write events. Implemented in all three built-in adapters
    (memory, localStorage, cookie).

  **Event types:**
  - `cache.hit`, `cache.miss`, `query.refetch`, `query.error`
  - `mutation.success`, `mutation.error`
  - `auth.refresh`
  - `storage.write`
  - `custom`

  No breaking changes. The entire telemetry layer is no-op when
  `onTelemetry` is not passed. Existing `TokenProvider` / `EmporixStorage`
  implementations continue to work without implementing the new optional
  methods.

- [#50](https://github.com/viuteam/emporix-sdk/pull/50) [`4157818`](https://github.com/viuteam/emporix-sdk/commit/4157818c27b32ff32a1a41235bc7920137402f88) Thanks [@amnael1](https://github.com/amnael1)! - Order service (customer foundation):
  - New `client.orders` — `listMine` / `get` / `transition` / `cancel` over the customer-facing `/order-v2/{tenant}/orders/*` endpoints. All methods accept an `opts.saasToken` forwarded as the `saas-token` header.
  - New `client.salesOrders` — `get` / `update` over `/order-v2/{tenant}/salesorders/{id}` for backend / service-account use (status, mixins, custom attributes patches). `update` accepts `opts.recalculate` (server default `true`).
  - New hand-rolled `Order`, `OrderItem`, `OrderStatus`, `OrderTransition`, `SalesOrderPatch` types (pending real codegen).
  - New subpath export `@viu/emporix-sdk/orders`.
  - New `client.carts.addItemsBatch(cartId, items, auth)` — wraps `POST /cart/{tenant}/carts/{cartId}/itemsBatch` (cap 200 items per call). Per-entry status surfaces partial failures via the generated `BatchResponse` shape.

  No breaking changes. The full `/salesorders` admin list, order split, returns, and order events are deferred sub-specs.

- [#24](https://github.com/viuteam/emporix-sdk/pull/24) [`2014f71`](https://github.com/viuteam/emporix-sdk/commit/2014f710ee363f35aea1d8af0e85bce69a5bc40a) Thanks [@amnael1](https://github.com/amnael1)! - Harmonize all paginated SDK surfaces on `PaginatedItems<T>`. Removes the
  legacy `Page<T>` shape (whose `total` was always `NaN`, since the HTTP
  client never exposed `X-Total-Count`) and the `paginate()` async
  iterator.

  **BREAKING:**
  - `ProductService.list` / `ProductService.search` now return
    `PaginatedItems<Product>` (`{ items, pageNumber, pageSize, hasNextPage }`)
    instead of `Page<Product>` (`{ items, total, offset, limit }`).
  - `CategoryService.list` returns `PaginatedItems<Category>`;
    `CategoryService.productsIn` returns `PaginatedItems<Product>`.
  - `useProducts` / `useCategories` now resolve to `PaginatedItems<T>`.
  - `Page<T>` and `paginate()` are no longer exported from `@viu/emporix-sdk`.

  **Fixed:**
  - `useProductsInfinite` previously over-fetched a trailing empty page
    before terminating, and its `getNextPageParam` was tied to the
    fetched-page count rather than the cursor. It now derives the next
    page from `last.hasNextPage` / `last.pageNumber + 1` — same pattern as
    the segment-hydrate infinite hooks.

  **Added:**
  - `useCategoriesInfinite` — mirror of `useProductsInfinite`.
  - `iterateAll<T>(fetchPage, start?)` async iterator over
    `PaginatedItems<T>`. Replaces `paginate()` for "iterate every item
    across pages" use cases.

  **Migration:**

  ```ts
  // Before
  const { items, total } = await client.products.list({ pageNumber: 1, pageSize: 50 });
  // total was always NaN.

  // After
  const { items, hasNextPage } = await client.products.list({ pageNumber: 1, pageSize: 50 });
  ```

  ```ts
  // Before
  for await (const p of paginate((offset, limit) => svc.list(...), 50)) { ... }

  // After
  for await (const p of svc.listAll({ pageSize: 50 })) { ... }
  // or, for custom sources:
  for await (const x of iterateAll<X>((pageNumber) => fetchPage(pageNumber))) { ... }
  ```

- [#13](https://github.com/viuteam/emporix-sdk/pull/13) [`dfabb02`](https://github.com/viuteam/emporix-sdk/commit/dfabb02882ca65e2a32e4a52082c0b14dc71faa8) Thanks [@amnael1](https://github.com/amnael1)! - Add `PriceService` (price matching only). `prices.matchByContext(input, auth?)`
  resolves prices from the session context (default anonymous token);
  `prices.match(input, auth?)` resolves from an explicit context (default
  service token). Both the request and the response use the generated price
  schema — `PriceMatchByContextInput` (`MatchByContext`), `PriceMatchInput`
  (`Match`), `PriceMatch` (`MatchResponse`) — so every spec field is typed.
  Exposed on `EmporixClient.prices` and via the `@viu/emporix-sdk/price`
  subpath.

- [#31](https://github.com/viuteam/emporix-sdk/pull/31) [`13f23bd`](https://github.com/viuteam/emporix-sdk/commit/13f23bd9016903c59ca1bfa0b340ff096587131e) Thanks [@amnael1](https://github.com/amnael1)! - Add npm publish readiness metadata: `license` (MIT), `repository`, `bugs`, `homepage`, `author`, `keywords` in `package.json`. Adds the `LICENSE` file at the repo root (npm includes it in each package tarball automatically). No code changes; the next release will be the first one with full npm-side metadata for discoverability + provenance attestation.

- [#48](https://github.com/viuteam/emporix-sdk/pull/48) [`5f330d5`](https://github.com/viuteam/emporix-sdk/commit/5f330d521119e36ca95b8cfc3bed049572fd1c03) Thanks [@amnael1](https://github.com/amnael1)! - Raise Node.js engines floor from `>=18` to `>=20.19.0`. Node 18 reached end-of-life on 30 April 2025; Node 20 LTS (≥ 20.19.0, which ships flag-free `require(esm)`) is the new minimum. Development happens on Node 24 LTS (`.nvmrc` updated); CI exercises Node 20, 22, and 24.

  No code changes — no SDK feature uses a Node API beyond what Node 20 provides. Browser consumers are unaffected.

- [#23](https://github.com/viuteam/emporix-sdk/pull/23) [`027b816`](https://github.com/viuteam/emporix-sdk/commit/027b816c171e81263b99b791916e33816f148839) Thanks [@amnael1](https://github.com/amnael1)! - Segment hydrate now uses a single Emporix `POST /search` per page instead
  of N+1 `GET /products/{id}` calls. New
  `ProductService.searchByIds(ids, { chunkSize? }, auth?)` and
  `CategoryService.searchByIds(...)` POST `/search` with
  `q="id:(id1,id2,…)"`, chunking at 100 IDs by default. Adds the generic
  `PaginatedItems<T>` (`{ items, pageNumber, pageSize, hasNextPage }`) in
  `core/context.ts`.

  **BREAKING:** `SegmentService.listMyProducts` and
  `SegmentService.listMyCategories` now return `PaginatedItems<Product>` /
  `PaginatedItems<Category>` instead of a flat `Product[]` / `Category[]`.
  `SegmentService.listItems` gains optional `pageNumber` / `pageSize`
  params (additive). `listMyProductIds` / `listMyCategoryIds` are
  unchanged.

  React adds four new hooks: `useMySegmentProducts` /
  `useMySegmentProductsInfinite` and `useMySegmentCategories` /
  `useMySegmentCategoriesInfinite`. The infinite variants use
  `useInfiniteQuery` with a `pageNumber` cursor and `hasNextPage`-driven
  `getNextPageParam`. All four are disabled when no customer token is in
  storage.

- [#20](https://github.com/viuteam/emporix-sdk/pull/20) [`4cda829`](https://github.com/viuteam/emporix-sdk/commit/4cda82963d307fa12b1e1e628be31879f464ed9d) Thanks [@amnael1](https://github.com/amnael1)! - Add Emporix customer SSO support. `customers.socialLogin({ code, redirectUri,
codeVerifier?, sessionId? })` performs the Authorization-Code code exchange
  (`POST /customer/{tenant}/socialLogin`); `customers.exchangeToken({
subjectToken, config? })` performs the RFC 8693 token exchange
  (`POST /customer/{tenant}/exchangeauthtoken`). Both default to anonymous auth
  and return a `CustomerSession` (now with optional `socialAccessToken` /
  `socialIdToken` from socialLogin); `expires_in` is normalized to a number
  across both flows. `useCustomerSession` gains `socialLogin` and
  `exchangeToken` actions that store the session like `login`.

- [#25](https://github.com/viuteam/emporix-sdk/pull/25) [`277ae71`](https://github.com/viuteam/emporix-sdk/commit/277ae7195ab9eecb87677fff4e8fcd16ea3b920b) Thanks [@amnael1](https://github.com/amnael1)! - Hook-only guest checkout + persistent anonymous cart.

  **SDK (`@viu/emporix-sdk`)**
  - New `AnonymousSessionStore` interface and optional `TokenProvider.attachAnonymousStore` method. When a host (e.g. `EmporixProvider`) supplies a store, `DefaultTokenProvider` bootstraps `anon` from the store on first use (taking the refresh-token path, so `sessionId` is preserved) and writes the rotated `refreshToken` + `sessionId` back after every login / refresh. With no store attached, behavior is identical to before.
  - `invalidateAnonymous()` now also clears the attached store (`write(null)`).
  - `EmporixClient.tokenProvider` is now a public, read-only field — so hosts can call `attachAnonymousStore` after construction.

  **React (`@viu/emporix-sdk-react`)**
  - `TokenStorage` renamed to `EmporixStorage` (alias `TokenStorage` is kept). New methods: `getCartId / setCartId`, `getAnonymousSession / setAnonymousSession`. All three storage backends — memory, `localStorage`, cookie — implement them.
  - `EmporixProvider` wires the storage's anonymous-session accessors to the SDK's `attachAnonymousStore` so the anonymous cart can survive a browser reload.
  - New `useCreateCart` mutation hook: auto-detects customer vs anonymous auth and persists `cartId` via `storage.setCartId`.
  - `useCheckout` no longer throws on missing customer token — it auto-detects (customer if a token is stored, else anonymous). `usePaymentModes` keeps its customer-only behavior. Backward-compatible for existing logged-in flows.

  **Migration**

  No code change needed for existing consumers — both packages' changes are additive or strict supersets. New persistence kicks in automatically when consumers use one of the persistent storage backends (`createLocalStorageStorage()` or `createCookieStorage()`).

### Patch Changes

- [#7](https://github.com/viuteam/emporix-sdk/pull/7) [`e10854f`](https://github.com/viuteam/emporix-sdk/commit/e10854fc9ef11fec74f24e65dedbe11c3ca09d22) Thanks [@amnael1](https://github.com/amnael1)! - Document the checkout & payment flow (docs/checkout.md, saas-token note in
  docs/auth.md, README links) and add a Next.js checkout-step example. No API
  changes.

- [#28](https://github.com/viuteam/emporix-sdk/pull/28) [`4fc01ef`](https://github.com/viuteam/emporix-sdk/commit/4fc01ef737c9397407937ee9ca8098a781ac075e) Thanks [@amnael1](https://github.com/amnael1)! - Add live end-to-end test suite (`@viu/emporix-e2e`, private) running through the `examples/vite-spa` Example against the `viu` tenant. Six specs cover the four critical user flows:
  - **`catalog.spec.ts`** — anonymous catalog renders 12 products; only `GET /anonymous/login` + `GET /product/viu/products` hit Emporix on `/`.
  - **`customer-session.spec.ts`** — login resolves the customer profile + stores the token; logout clears the token.
  - **`guest-checkout.spec.ts`** — `useCreateCart` → `useCartMutations.addItem` → `useCheckout.placeOrder` (anonymous) → real order `EONxxxx` placed on `viu`.
  - **`customer-cart-onboarding.spec.ts`** — guest cart created → login → `GET /cart/viu/carts?siteCode=main&create=true` + `POST /merge` fire → `storage.cartId` switched to the customer cart.

  This is the first **live** verification of the PR #26 customer-cart-onboarding flow, previously covered only by MSW mocks. No SDK/React code changes — the suite is purely additive test infrastructure (separate `e2e/` workspace package, `@playwright/test` v1.49, `workflow_dispatch` CI workflow). Credentials are env-driven (`EMPORIX_TEST_CUSTOMER_EMAIL` / `_PASSWORD`); login-bound specs skip cleanly without them. Passwords are filled via a custom `fillSecret` helper that bypasses `page.fill()` so values never appear in the HTML report or action log.

  Local runs: `pnpm e2e`. CI runs: trigger `e2e.yml` from the Actions tab. See [`docs/e2e.md`](../docs/e2e.md) for authoring workflow + Playwright Agent CLI usage.

- [#4](https://github.com/viuteam/emporix-sdk/pull/4) [`5f6cb4a`](https://github.com/viuteam/emporix-sdk/commit/5f6cb4ad207f4a1c8562d1da1713255762b9c436) Thanks [@amnael1](https://github.com/amnael1)! - Add documentation (root + package READMEs, CONTRIBUTING, docs/logging,
  docs/auth, docs/react) and runnable examples (node-server, vite-spa,
  next-app-router). No API changes.

- [#11](https://github.com/viuteam/emporix-sdk/pull/11) [`40f8e65`](https://github.com/viuteam/emporix-sdk/commit/40f8e65177699685c1114714f5b3f080cfab89f2) Thanks [@amnael1](https://github.com/amnael1)! - Order `exports` conditions so `types` resolves first. Node and the
  TypeScript resolver evaluate `exports` conditions in declaration order;
  with `import`/`require` listed before `types`, the `types` condition was
  never reached, emitting build warnings and preventing consumers from
  picking up the generated `.d.ts` entry points. Every subpath in both
  packages now uses `{ types, import, require }` order.

- [#44](https://github.com/viuteam/emporix-sdk/pull/44) [`d0cc756`](https://github.com/viuteam/emporix-sdk/commit/d0cc75603db779447c4ffe84aa349c8e59db13df) Thanks [@amnael1](https://github.com/amnael1)! - Include LICENSE in the published npm tarballs. The `files` array already
  declared `LICENSE` but the file was only present at the repo root; npm
  publishes per-package, so a copy now lives inside each package directory.
  Fixes "License: not specified" on npmjs.com and unblocks corporate
  license-compliance scanners (Snyk, Black Duck).

- [#46](https://github.com/viuteam/emporix-sdk/pull/46) [`11ca224`](https://github.com/viuteam/emporix-sdk/commit/11ca22430e376814819faec0f9946a234ef0e9bd) Thanks [@ndyn](https://github.com/ndyn)! - Pre-1.0 publish metadata polish:
  - **`@viu/emporix-sdk-react`**: tighten the `@tanstack/react-query` peer
    range from `^5.0.0` to `^5.51.0`. This matches the version the package
    is developed and tested against. The previous range claimed support
    for v5.0–v5.50 that was never exercised in CI; tightening avoids a
    silent runtime mismatch for consumers who happen to be on those older
    patch versions.
  - **Both packages**: replace the bare-string `author: "viuteam"` with an
    `author` object — `{ "name": "viu", "url": "https://github.com/viuteam" }`
    — so the npm package page shows "viu" (our display name) and links
    back to the GitHub org page (`viuteam`, the actual org slug).
  - **`LICENSE` (root and per-package)**: the MIT copyright holder is now
    `VIU AG` (the legal entity) instead of the GitHub org slug `viuteam`,
    so license-compliance scanners attribute the package correctly.

- [#3](https://github.com/viuteam/emporix-sdk/pull/3) [`e2f74db`](https://github.com/viuteam/emporix-sdk/commit/e2f74db04edb1d4250add83a4b8208bc33e326c7) Thanks [@amnael1](https://github.com/amnael1)! - Add @viu/emporix-sdk-react: provider, pluggable token storage, customer
  session, query hooks, cart mutations with optimistic updates, error helpers and
  SSR prefetch helpers. Core: expose EmporixClient.tenant for query-key namespacing.
