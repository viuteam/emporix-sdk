---
"@viu/emporix-sdk": minor
---

Export `resolveZone` and `pickFee` alongside the shipping service, plus the
`ShippingFee` type they use.

Both are pure functions — no client, no request — lifted verbatim from the
storefront demo, where they had no test coverage. They now have ten tests,
including the `<=` boundary that decides whether a cart total exactly meeting a
free-shipping threshold gets free shipping.

- `resolveZone(zones, country)` — the zone whose `shipTo` covers the country,
  else the default zone, else the first.
- `pickFee(fees, cartTotal)` — the highest `minOrderValue` at or below the
  total, else the first fee.

The fee type is exported as `ShippingFee` rather than `Fee`, because the Fee
service already owns that name at the package root.
