---
"@viu/emporix-sdk-react": patch
---

fix multiple checkouts per session: `useCheckout().placeOrder`/`placeOrderFromQuote` now reset the cart on success — they clear `storage.cartId` and drop the `["emporix","cart-bootstrap"]` query cache (held with `staleTime: Infinity`). Previously a placed order closed its cart server-side, but the bootstrap cache still re-served that closed cart on the next `useActiveCart({ create: true })`, so the second checkout re-adopted the dead cart and failed (cart reads 404, `placeOrder` 401). The next checkout now bootstraps a fresh cart.
