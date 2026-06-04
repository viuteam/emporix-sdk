---
"@viu/emporix-sdk-react": patch
---

fix(react): drop the cart on logout and react to cart-id clearing

Two related cleanup gaps caused follow-up errors after logout and checkout:

- `useCustomerSession().logout()` cleared the customer token but left the
  stored `cartId`. The cart belonged to the customer and isn't accessible
  anonymously, so the cart query immediately refetched it and got a `403`.
  Logout now clears `cartId` too.
- `useActiveCart` cached the cart id in local state and never reacted to
  external `storage.setCartId(null)` (logout, or the post-order cleanup that
  closes the cart). It kept fetching the dead cart id — a `403` after logout,
  a `404` after checkout. It now subscribes to storage cart-id changes and
  syncs, so clearing the id stops the fetch (and a logged-out cart page
  bootstraps a fresh anonymous cart on demand).
