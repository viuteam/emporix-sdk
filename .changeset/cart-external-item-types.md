---
"@viu/emporix-sdk": patch
---

fix(sdk): type external cart items as Emporix documents them

`CartItemInput` (and `CartItemUpdate`) could not express an external item, the body Emporix's "External Products, Pricing and Fees" guide documents for products and prices from outside Emporix:

- `itemType: "EXTERNAL"` did not compile. The spec wraps the enum in an `allOf` with an empty object, and the generated type was the intersection of a string and an object, which no value satisfies.
- `price.priceId` was required, although the spec says it must not be sent when `itemType` is `EXTERNAL`.

Two patches to the vendored cart spec fix both, so `client.carts.addItem` takes an external item without a cast. Both only widen request types: every body that compiled before still compiles. Response types are unchanged. Sending external items needs a service token with `cart.cart_manage_external_prices`; see `docs/cart.md`.
