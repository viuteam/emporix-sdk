---
"@viu/emporix-sdk-react": minor
---

`useCustomerSession()` now exposes the current `saasToken`. It was already
tracked internally (from `login` / `exchangeToken`) but not returned — so
consumers couldn't pass it to `useCheckout().placeOrder({ ..., saasToken })` for
customer checkout, or to saas-token-gated order reads.
