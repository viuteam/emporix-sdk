# Cart Admin/Lifecycle CRUD — Design

**Date:** 2026-07-24
**Package:** `@viu/emporix-sdk`
**Service:** `CartService` (`client.carts`)
**Spec source:** `packages/sdk/specs/cart.yml` → generated `src/generated/cart/types.gen.ts`

## Goal

The Cart service is already heavily wrapped (create/get/items/coupons/merge/…,
much of it from PR #160). Eight operations remain unwrapped — the cart
lifecycle/admin edge (search, delete, full update), the discount reads/deletes,
the delivery-time restrictions read, and the single item-detail read. This work
closes that gap and completes coverage of `cart.yml`.

## Scope

Extend the existing `CartService` class in place with **flat methods** (no
sub-resource — consistent with the existing `applyCoupon`/`removeCoupon`). No
client wiring change, no constructor change.

8 operations are added. The existing methods (including `applyCoupon` /
`removeCoupon`, which already go through `/discounts`) are unchanged.

### Already covered (unchanged)

`create`, `get`, `getCurrent`, `addItem`, `addItemsBatch`, `updateItem`,
`removeItem`, `clear`, `applyCoupon`, `removeCoupon`, `validate`, `listItems`,
`refresh`, `changeSite`, `changeCurrency`, `updateItemsBatch`,
`setShippingAddress`, `setBillingAddress`, `merge`.

## Auth model (split)

The Cart service requires an explicit `customer`/`anonymous` context on every
existing method (via the `requireCartAuth` guard) — a cart belongs to a
customer or an anonymous session; there is no service-token default. The new
operations split by nature:

- **Backend/admin ops** — `search`, `delete`, `update` — take an **unguarded**
  `auth: AuthContext`. `search` scans carts tenant-wide (a customer token
  cannot do that — it needs a service/elevated scope), and `delete`/`update`
  are used both by admins (service token, any cart) and by owners (customer
  token, own cart). These methods forward `auth` as-is; the server enforces
  scope (403 on insufficient).
- **Storefront ops** — `getItem`, `listDiscounts`, `removeAllDiscounts`,
  `removeDiscountByIndex`, `getDeliveryRestrictions` — keep the
  `requireCartAuth` guard (customer/anonymous), matching the sibling storefront
  methods.

## API surface

### Backend/admin (unguarded `auth: AuthContext`)

| Method | HTTP | Returns |
|---|---|---|
| `search(query, params?, auth)` | POST `/carts/search` (body `{ q }`) | `CartSummary[]` (200) |
| `delete(cartId, auth)` | DELETE `/carts/{cartId}` | `void` (204) |
| `update(cartId, input, auth)` | PUT `/carts/{cartId}` (204) → re-fetch | `Cart` |

- `search` `params`: `pageNumber?`, `pageSize?`, `sort?`, `fields?` — forwarded
  as query. Response items are `CartGetAll` (a cart summary, aliased
  `CartSummary`).
- `update` body is `UpdateCart` (aliased `CartUpdateInput`). The endpoint
  returns 204 (no body), so the method re-fetches via a **direct** `GET
  /carts/{cartId}` using the same `auth` (not `this.get`, which would reject a
  service token through `requireCartAuth`) and returns the updated `Cart`.
- `delete` returns `void` — the cart no longer exists to re-fetch.

### Storefront (`requireCartAuth`)

| Method | HTTP | Returns |
|---|---|---|
| `getItem(cartId, itemId, auth)` | GET `/carts/{cartId}/items/{itemId}` | `CartItem` (200) |
| `listDiscounts(cartId, auth)` | GET `/carts/{cartId}/discounts` | `CartDiscount[]` (200) |
| `removeAllDiscounts(cartId, auth)` | DELETE `/carts/{cartId}/discounts` → re-fetch | `Cart` |
| `removeDiscountByIndex(cartId, discountIndex, auth)` | DELETE `/carts/{cartId}/discounts/{discountIndex}` → re-fetch | `Cart` |
| `getDeliveryRestrictions(cartId, auth)` | GET `/carts/{cartId}/dtRestrictions` | `CartDeliveryRestrictions` (200) |

- `getItem` re-adds the item-detail read that PR #160 dropped as YAGNI — now
  included to complete the item sub-API and the coverage row.
- `removeAllDiscounts` calls `DELETE /discounts` with **no** `codes` query (the
  endpoint removes all discounts when no codes are given). `removeCoupon(code)`
  already covers the codes-filtered case; this method is the clear-all variant.
- Both discount deletes return 204, so they re-fetch via `this.get(cartId,
  cartAuth)` and return the updated `Cart` — consistent with
  `applyCoupon`/`removeCoupon`.

### Public types (alias → generated)

| Public alias | Generated type |
|---|---|
| `CartSearchInput` | `Search` (`{ q?: string }`) |
| `CartSummary` | `CartGetAll` |
| `CartUpdateInput` | `UpdateCart` |
| `CartDiscount` | `DiscountResponse` |
| `CartDeliveryRestrictions` | `CartDtRestrictions` |

All exported from `packages/sdk/src/index.ts` alongside the existing cart types.

## Error handling

No new error handling — the shared `HttpClient` maps status codes to the
`Emporix*Error` hierarchy. `requireCartAuth` throws `EmporixValidationError`
before any request when a storefront op is called without a customer/anonymous
context (existing behavior, reused).

## Testing

New unit test `packages/sdk/tests/services/cart-admin.test.ts` using the
`vi.fn()`-mocked `http.request` harness (`ctxWith`), mirroring
`segment-admin.test.ts`.

- **Backend block:** `search` POSTs `/carts/search` with the `q` body and
  accepts a service auth; `delete` DELETEs `/carts/{cartId}`; `update` PUTs then
  re-fetches (two calls: PUT `/carts/{cartId}` then GET `/carts/{cartId}`) and
  returns the fetched `Cart`.
- **Storefront block:** `getItem`, `listDiscounts`, `getDeliveryRestrictions`
  hit the right method+path; `removeAllDiscounts` DELETEs `/discounts` (no
  `codes`) then re-fetches; `removeDiscountByIndex` DELETEs
  `/discounts/{index}` then re-fetches.
- **Auth-guard block:** a storefront op (`listDiscounts`) called with
  `{ kind: "service" }` throws `EmporixValidationError` and makes no request; a
  backend op (`search`) called with `{ kind: "service" }` is allowed and issues
  the request.

## Release

Changeset `.changeset/cart-admin-crud.md`, `@viu/emporix-sdk` **minor**
(additive: new methods + types, no change to existing behavior).

## Out of scope

- **Known pre-existing bug (flagged separately, not fixed here):**
  `setShippingAddress`/`setBillingAddress` (`cart.ts`) target
  `/carts/{cartId}/shipping-address` and `/carts/{cartId}/billing-address` —
  paths that do not exist in `cart.yml`. Cart addresses are set via `PUT
  /carts/{cartId}` with `{ addresses: [{ …type: "BILLING" }, { …type:
  "SHIPPING" }] }` (`UpdateCart.addresses`). Same class as the PR #159
  divergences. Tracked as its own task; this PR keeps the scope to the eight
  missing operations.
- React hooks for the new operations (backend/admin ops are not
  storefront-facing; the discount/dtRestrictions reads can get hooks in a later
  storefront pass if needed).
- Live tenant verification (pure facade + unit tests, as with the prior admin
  PRs).
