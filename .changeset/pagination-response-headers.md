---
"@viu/emporix-sdk": minor
---

feat(sdk): expose response headers to facades

`HttpClient.requestWithMeta` returns the parsed body together with the response
`Headers`, and `PaginatedItems` gains optional `totalCount`, `nextCursor` and
`prevCursor`. Nothing surfaces them yet; this is the groundwork that lets the
facades read Emporix's `X-Total-Count` and cursor headers at all.

`RequestOptions.query` also widens to accept booleans, so a facade can pass one
through instead of stringifying it at the call site.
