---
"@viu/emporix-sdk": minor
---

feat(sdk): support cursor pagination on schema custom instances

`listInstances` and `searchInstances` now declare `next` / `prev`, return the
cursors the server sends back, and `searchInstances` finally forwards
`pageNumber`, `pageSize` and `sort` — it forwarded none of them and always
claimed `hasNextPage: false`, so a search could only ever return the server's
default first page. New `listAllInstances` iterates a whole type by cursor.

Note: `searchInstances` gained a third `query` parameter, so a positional `auth`
argument moves to fourth.
