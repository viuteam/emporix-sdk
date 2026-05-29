---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add PriceService.matchByContextChunked and the useMatchPricesChunked React hook:
split large match-prices-by-context requests into bounded-concurrency chunks
(default 50 items, 4 in flight) with per-chunk error handling.
