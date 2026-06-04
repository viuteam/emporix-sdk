---
"@viu/emporix-sdk-react": patch
---

fix(react): refresh the cart after a 204-only mutation

`useCartMutations` assumed every cart write echoes the full updated cart.
A partial quantity update (`updateItem(..., { partial: true })`) returns
`204 No Content`, which the SDK resolves to `undefined` — and
`setQueryData(key, undefined)` is a no-op in React Query, so the cart cache
stayed stale and the UI did not reflect the change. The mutation now adopts
a real cart body when one is returned and otherwise invalidates the cart
query so it refetches. This also makes coupon/address/remove mutations
reconcile with the server when they return no body.
