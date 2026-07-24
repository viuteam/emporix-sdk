---
"@viu/emporix-sdk": minor
---

Add the remaining cart operations to `client.carts`: backend `search` (POST
`/carts/search`), `delete`, and `update` (which take an unguarded auth so a
service token can manage any cart), plus storefront `getItem`, `listDiscounts`,
`removeAllDiscounts`, `removeDiscountByIndex`, and `getDeliveryRestrictions`
(which keep the customer/anonymous guard). Mutating ops re-fetch and return the
updated `Cart` (`delete` returns void). Existing cart methods are unchanged.
