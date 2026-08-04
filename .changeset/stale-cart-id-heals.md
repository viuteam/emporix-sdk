---
"@viu/emporix-sdk-react": patch
"@viu/emporix-sdk-next": patch
---

Fix the multi-device cart: a cart closed by a checkout elsewhere no longer leaves
the other devices broken.

Emporix allows a customer one open cart per site and placing an order closes it.
The cart id is cached per device (`emporix.cartId` in React storage, in the
session cookie or store in Next), so every other device where that customer is
signed in kept calling a closed cart and got `404`. It never recovered:
`useActiveCart({ create: true })` only bootstraps when the id is `null`, and a
stale id is not `null`. In Next it was worse — the read happens in a Server
Component, so the `404` reached the error boundary, and `addToCart` failed
forever because it found a non-null id and never created a new cart.

**React.** `useCart` and `useCartMutations` treat a `404` on the **stored** id as
«this cart is gone»: they clear `storage.cartId` and drop the `cart-bootstrap`
cache, so the next render bootstraps a fresh cart. Silent by design — the cart no
longer exists server-side, so the shopper sees an empty bag rather than an error.
An explicitly passed id (`useCart("other-cart")`) never touches storage, and only
a `404` counts: a `403` or `5xx` means «not now», not «gone».

The emporix-scoped `retry` default no longer retries a `404` at all. It is an
answer, not a failure, and Emporix bills the repeat — a stale cart id used to pay
for the same answer twice on every mount.

**Next.** `withEmporixSessionMutable` now flushes the session handle even when the
callback throws. In store mode the handle buffers in memory and wrote once at the
end, so a failed Server Action discarded whatever it had already set — including a
rotated anonymous refresh token. Emporix rotates that token on every refresh, so
the session was left pointing at one the tenant had already invalidated, the next
request fell back to a fresh login with a new `sessionId`, and the guest lost
their cart. Cookie mode always wrote through and was never affected. A store
failure during the flush is swallowed rather than replacing the caller's error.

The dead-cart-id recovery itself is documented rather than automated on the Next
side, because a Server Component **cannot** heal it: a read-only handle does not
write. The package README and `examples/next-server-first` show the rule — render
the empty state on a read, clear and re-create inside the next write.
