---
"@viu/emporix-sdk-react": patch
---

Keep the cart when a write 404s only because its item is gone.

`useCartMutations` used to treat every `404` as «this cart is gone» and cleared
`storage.cartId`. But Emporix answers an item that is already gone with the same
`404` as a closed cart («Cart item not found in cart … with code 9»). So removing
or updating a line that another tab had already removed dropped the whole cart.
The UI showed no cart until `useActiveCart({ create: true })` bootstrapped it
again.

A write's `404` is now checked instead of trusted. The hook re-reads the cart and
clears the id only if that read 404s too, which it does only when the cart really
was closed, for example by a checkout on another device. Otherwise the id stays
and the cache takes the cart the server has, so the missing line disappears
instead of coming back with the rollback. The extra GET happens only on the `404`
path, and the recovery still works when no cart read is mounted.
