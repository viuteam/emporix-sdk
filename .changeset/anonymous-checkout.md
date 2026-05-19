---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

`credentials.storefront.context` (`{ currency, siteCode, targetLocation }`)
is now sent at anonymous-login so `prices.matchByContext` resolves prices
from the session. Adds the `useMatchPrices` React hook. The next-app-router
and vite-spa examples now include an anonymous guest-checkout flow.

BREAKING: `CartService.create` now returns the generated `CartCreated`
(`{ cartId, yrn }`) — the actual create-endpoint response — instead of the
`Cart` GET model. Read `cart.cartId` (not `cart.id`) from the result.
