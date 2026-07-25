---
"@viu/emporix-sdk": minor
---

Add product admin writes to `client.products`: `create`, `update` (PATCH),
`replace` (PUT, with an optional `partial` flag), `delete` (with `force`),
`bulkCreate`/`bulkUpdate` (207 Multi-Status — inspect each entry), the
dynamic-variant recalculation group (`recalculate`, `listRecalculationJobs`,
`getRecalculationJob`), and a `products.templates` sub-resource
(`list`/`get`/`create`/`update`/`delete`). Writes default to service auth and
expose the endpoints' query flags (`skipVariantGeneration`, `doIndex`,
`skipRelatedItemsValidation`); the existing catalog reads are unchanged.
