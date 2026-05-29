# @viu/emporix-sdk

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
