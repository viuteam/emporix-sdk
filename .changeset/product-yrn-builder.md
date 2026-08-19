---
"@viu/emporix-sdk": minor
---

Add `productYrn(tenant, productId)`, the inverse of `productIdFromYrn` and the form
`carts.addItem` requires. Also notes in `productIdFromYrn` that approval resource
items carry a bare product id rather than a YRN, so callers need the `itemId` fallback.
