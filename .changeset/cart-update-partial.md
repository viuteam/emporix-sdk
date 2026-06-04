---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Support partial cart-item updates. `client.carts.updateItem(cartId, itemId,
patch, auth, { partial: true })` now sends `?partial=true`, so a quantity-only
change can be `{ quantity }` instead of a full item replace (which otherwise
requires re-sending `itemYrn` + the `price` row). The React
`useCartMutations().updateItem` mutation accepts an optional `partial` flag in
its variables. Default behavior is unchanged.
