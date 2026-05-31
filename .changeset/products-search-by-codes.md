---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add `products.searchByCodes(codes, { chunkSize? })` — bulk-fetch products by
`code` via `POST /products/search` (`q="code:(…)"`), chunked at 100, analogous
to `searchByIds`. Codes with query-delimiter characters are dropped with a
warning. Adds the `useProductsByCodes` React hook (30s stale-time).
