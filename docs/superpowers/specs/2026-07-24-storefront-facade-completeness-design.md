# Storefront Facade Completeness — Design

- **Date:** 2026-07-24
- **Status:** approved (design)
- **Scope:** `@viu/emporix-sdk` (core) + `@viu/emporix-sdk-react` (hooks)
- **Follows:** the facade-vs-spec coverage analysis (2026-07-24) and PR #159 (which fixed the four *broken* facade paths/methods). This round adds the **storefront-relevant endpoints that are simply missing** (not broken) — no admin/backend CRUD.

## 1. Motivation

The endpoint-for-endpoint coverage audit found that the SDK deliberately wraps only a storefront-relevant subset of each service. Most gaps are intentional (admin CRUD, deprecated ops). A minority are **storefront-facing** operations a real storefront needs but that are not yet wrapped. This design rounds out that subset across five services so the storefront layer is functionally complete, without expanding into admin territory.

## 2. Goals / Non-goals

**Goals**
- Add 20 storefront-relevant methods across `carts`, `customers`, `categories`, `payments`, `sessionContext`.
- Add matching React-Query hooks (reads via `useEmporixQuery`, writes via `useMutation`).
- Stay **backward-compatible**: only add methods; do not rename or change existing ones.
- Alias generated request/response types (never hand-author wire shapes).

**Non-goals**
- No admin/management CRUD (price lists, product/category writes, segment management, payment-mode config, session-context admin-by-`sessionId`, etc.).
- No new services, channels, or client accessors — all five services already exist.
- No changes to the four methods fixed in #159.

## 3. Design conventions

- **Auth** follows each service's existing convention:
  - `carts.*` → `requireCartAuth` (explicit `customer` or `anonymous`), matching the other cart methods.
  - `categories.*` → default `anonymous` (`ANON`), matching existing category reads.
  - `payments.*` → default `anonymous` (`ANON`), matching `listPaymentModes` ("no scope required").
  - `sessionContext.*` → default `anonymous`, matching existing `get`/`patch` (the session is derived from the token).
  - `customers` account-lifecycle: `confirmSignup` / `resendActivation` / `confirmEmailChange` default `anonymous`; `changeEmail` and the `addresses.*` additions require `customer` (via `requireCustomer`).
- **Re-fetch pattern for state-changing cart ops.** `refresh` (204), `changeSite` / `changeCurrency` (200, no response body) do not return a cart. To preserve a useful `Promise<Cart>` contract, these apply the change and then `return this.get(cartId, auth)` — the same pattern PR #159 used for `applyCoupon`/`removeCoupon`.
- **Generated-type aliasing.** Public types alias the exact generated names (verified against `src/generated/*/types.gen.ts`).

## 4. Per-service design

### 4.1 `client.carts` (CartService)

| Method | HTTP | Path (after tenant) | Request type | Return |
|---|---|---|---|---|
| `validate(cartId, auth)` | GET | `/carts/{cartId}/validate` | — | `CartValidationResult` |
| `refresh(cartId, auth)` | PUT | `/carts/{cartId}/refresh` (204) | — | `Cart` (re-fetch) |
| `changeSite(cartId, siteCode, auth)` | POST | `/carts/{cartId}/changeSite` | `ChangeSite` `{ siteCode }` | `Cart` (re-fetch) |
| `changeCurrency(cartId, currency, auth)` | POST | `/carts/{cartId}/changeCurrency` | `{ currency }` | `Cart` (re-fetch) |
| `updateItemsBatch(cartId, items, auth)` | PUT | `/carts/{cartId}/itemsBatch` | `CartItemsBatchUpdateRequest` | `CartItemsBatchUpdateResponse` |
| `listItems(cartId, auth)` | GET | `/carts/{cartId}/items` | — | `CartItem[]` |

- New public types: `CartValidationResult` (alias generated `CartValidationResult`), `CartItem` (alias `CartItemResponse`; `listItems` returns `CartItemResponse[]` = generated `CartItemsResponse`), `CartItemsBatchUpdate*` aliases.
- `updateItemsBatch` mirrors the existing `addItemsBatch` (POST) — per-entry status, partial failures do not throw.
- `getItem` (single item) was **dropped** (YAGNI — `listItems` covers it).

### 4.2 `client.customers` (CustomerService)

| Method | HTTP | Path (after tenant) | Auth | Request / Return |
|---|---|---|---|---|
| `confirmSignup(token, auth?)` | GET | `/signup/optin/{token}` | anon | → `CustomerSession` (double opt-in activates **and** logs in; response is `CustomerToken`, mapped via the existing `toSession`) |
| `resendActivation(input, auth?)` | POST | `/signup/optin/refresh_token` | anon | `RefreshToken` `{ email }` → void (202) |
| `changeEmail(input, auth)` | POST | `/me/accounts/internal/email/change` | customer | `ChangeEmailRequestDto` `{ email, password, newEmail, syncContactEmail? }` → void (204) |
| `confirmEmailChange(input, auth?)` | POST | `/me/accounts/internal/email/change/confirm` | anon | `UpdateEmail` `{ token }` → void (204) |
| `addresses.get(id, auth?)` | GET | `/me/addresses/{id}` | customer | → `Address` |
| `addresses.addTags(id, tags, auth?)` | POST | `/me/addresses/{id}/tags?tags=<csv>` | customer | `tags: string[]` (joined comma-separated) → void (204) |
| `addresses.removeTags(id, tags, auth?)` | DELETE | `/me/addresses/{id}/tags?tags=<csv>` | customer | `tags: string[]` → void (204) |

- `tags` is a **query** parameter (`?tags=BILLING,SHIPPING`); the facade accepts `string[]` and joins on `,`.
- `validateToken` (GET `/validateauthtoken`) was **dropped** (YAGNI — the SDK already manages token lifetime).
- New public request-type aliases: `ChangeEmailInput` (`ChangeEmailRequestDto`), `ConfirmEmailChangeInput` (`UpdateEmail`), `ResendActivationInput` (`RefreshToken`).

### 4.3 `client.categories` (CategoryService)

| Method | HTTP | Path (after tenant) | Return | Note |
|---|---|---|---|---|
| `parents(categoryId, auth?)` | GET | `/categories/{categoryId}/parents` | `Category[]` | breadcrumb-up |
| `childCategories(categoryId, auth?)` | GET | `/categories/{categoryId}/subcategories` | `Category[]` | **new name** — the existing `subcategories()` reads `/assignments` and stays unchanged |
| `getTree(categoryId, auth?)` | GET | `/category-trees/{categoryId}` | `CategoryTree` | single tree by id; existing `tree()` lists all trees |

- The exact response schemas for `parents` / `subcategories` / the single tree are confirmed during implementation; expected `Category[]` (`CategoryList`) and `CategoryTree`.

### 4.4 `client.payments` (PaymentGatewayService)

| Method | HTTP | Path (after tenant) | Auth | Request / Return |
|---|---|---|---|---|
| `getMode(id, auth?)` | GET | `/paymentmodes/frontend/{id}` | anon | → `PaymentMode` (single; existing `listPaymentModes` returns the array) |
| `initialize(input, auth?)` | POST | `/payment/frontend/initialize` | anon | `InitializePaymentRequest` → `InitializePaymentResponse` |

- Both endpoints are documented "no scope required"; default `ANON` matches `listPaymentModes`. New public types alias `PaymentModeFrontendResponse`, `InitializePaymentRequest`, `InitializePaymentResponse`.

### 4.5 `client.sessionContext` (SessionContextService)

| Method | HTTP | Path (after tenant) | Return |
|---|---|---|---|
| `addAttribute(attribute, auth?)` | POST | `/me/context/attributes` (201) | void |
| `removeAttribute(name, auth?)` | DELETE | `/me/context/attributes/{name}` (204) | void |

- Body of `addAttribute` aliases generated `ContextAttribute`. These "own" endpoints derive the session from the token; **no optimistic-locking version** is required (unlike `patch`).

## 5. React hooks (`@viu/emporix-sdk-react`)

One hook per new method, following existing patterns:

- **Reads** (`useEmporixQuery`, `mode: "read-auth"` unless customer-only): `useCartValidation`, `useCartItems`, `useCategoryParents`, `useChildCategories`, `useCategoryTree`, `usePaymentMode`, `useCustomerAddress` (single, customer-only).
- **Writes** (`useMutation`, extend existing mutation bundles where present): cart `refresh` / `changeSite` / `changeCurrency` / `updateItemsBatch` (added to the `useCartMutations` bundle); `useChangeEmail`, `useConfirmEmailChange`, `useConfirmSignup`, `useResendActivation`; `useAddAddressTags` / `useRemoveAddressTags`; `useAddSessionAttribute` / `useRemoveSessionAttribute`.
- Mutations invalidate the relevant `emporixKey` (cart, customer profile/addresses, session-context) on success, mirroring existing hooks.

## 6. Testing

- **SDK unit tests** (Vitest + MSW): one path/method assertion per new method; type-level `expectTypeOf` checks that public aliases match the generated shapes. Cart re-fetch methods assert the write **and** the follow-up `GET /carts/{id}`.
- **React tests** (jsdom + MSW): each hook mounts, calls, and asserts the resolved value / invalidation, following `coverage.test.tsx` and the per-hook test pattern.
- No live/E2E gating required; the paths are confirmed against the live tenant during implementation only if a shape is ambiguous.

## 7. Wiring

No new services, channels (`core/logger.ts`), client accessors, or index exports for services — all five already exist. Only **new public type exports** are added to `packages/sdk/src/index.ts` (and re-exported from each `*-types` module) and new hook exports from the React package root.

## 8. PR / plan structure

Single spec, single implementation plan, single PR (`feat/storefront-facade-completeness`). The plan is **phased per service** (carts → customers → categories → payments → sessionContext), each phase = SDK methods + types + tests, then a React-hooks phase, so implementation is incremental and independently verifiable. One changeset (`minor` — additive API surface on both packages).

## 9. Risks / open items

- Exact response schemas for `categories.parents` / `childCategories` / `getTree` and the `payments` frontend responses are confirmed against the generated types during implementation (assumed `Category[]` / `CategoryTree` / the aliased payment types here).
- `changeSite` / `changeCurrency` return 200 with no documented body; the re-fetch pattern makes the facade return the updated `Cart` regardless of whether the server later starts echoing one.
- `cart.updateItemsBatch` uses `CartItemsBatchUpdateRequest`/`Response`, distinct from the add-batch types — verify the generated update-entry shape when wiring.
