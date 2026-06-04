---
"@viu/emporix-sdk": minor
---

feat(price): expose canonical `itemId` on price-match results + `productIdFromYrn`

The deployed Emporix price API returns the matched item under `itemId` (with a
localized `name`), but the OpenAPI spec/codegen type calls it `itemRef` — so the
typed field was always `undefined` at runtime. `PriceService.match` /
`matchByContext` / `matchByContextChunked` now expose `itemId` canonically and
keep `itemRef` populated (mirrored from `itemId`) but `@deprecated`. Adds a
`productIdFromYrn(yrn)` helper to extract a product id from an `itemYrn`.
