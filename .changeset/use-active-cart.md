---
"@viu/emporix-sdk-react": minor
---

Add `useActiveCart(opts?)` hook to `@viu/emporix-sdk-react`. Resolves to the cart matching `storage.cartId`; with `opts.create = true`, bootstraps a new cart via `client.carts.getCurrent({siteCode, create: true})` when storage is empty.

Returns `UseQueryResult<Cart | null>`. Coexists with `useCart(cartId)` (different query-key); use `useActiveCart` for "the storefront's current cart" and `useCart(cartId)` for known ids.

Useful for:
- Cart-page mounts: `useActiveCart({ create: true })`.
- Header mini-cart: `useActiveCart()` (read-only, no auto-create).
- B2B quote carts in parallel to shopping carts: `useActiveCart({ create: true, type: "quote" })`.

No SDK change; uses the existing `client.carts.getCurrent` and `client.carts.get` APIs. Auto-detects customer vs anonymous auth like the other read hooks.
