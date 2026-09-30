---
"@viu/emporix-sdk": minor
---

feat(cart): add carts.execute for cart command chains

`client.carts.execute(cartId, commands, auth, { onError, versioning })` wraps
Emporix's new `POST /cart/{tenant}/carts/{cartId}/execute`: up to ten cart
operations on one cart in a single request, typically `AddCartItem` followed by
`GetCart`, so the calculated cart comes back with the write. `CartCommand` types
each command's `data` from its REST operation. With the default
`onError: "fail"`, a failed command throws the error its REST call would have
thrown — the commands before it are already applied; `onError: "resume"`
returns every result. See `docs/cart.md`.
