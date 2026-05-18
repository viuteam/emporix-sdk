---
"@viu/emporix-sdk": minor
---

Add `PriceService` (price matching only). `prices.matchByContext(items, auth?)`
resolves prices from the session context (default anonymous token);
`prices.match(input, auth?)` resolves from an explicit context (default
service token). Both return the full generated price-match schema
(`MatchResponse`). Exposed on `EmporixClient.prices` and via the
`@viu/emporix-sdk/price` subpath.
