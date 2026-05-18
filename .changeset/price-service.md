---
"@viu/emporix-sdk": minor
---

Add `PriceService` (price matching only). `prices.matchByContext(input, auth?)`
resolves prices from the session context (default anonymous token);
`prices.match(input, auth?)` resolves from an explicit context (default
service token). Both the request and the response use the generated price
schema — `PriceMatchByContextInput` (`MatchByContext`), `PriceMatchInput`
(`Match`), `PriceMatch` (`MatchResponse`) — so every spec field is typed.
Exposed on `EmporixClient.prices` and via the `@viu/emporix-sdk/price`
subpath.
