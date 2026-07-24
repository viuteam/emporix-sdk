---
"@viu/emporix-sdk": minor
---

Complete the order-v2 admin surface. `client.salesOrders` gains `list`,
`search`, `create`, `replace` (PUT full-replace, alongside the existing `update`
PATCH), `delete`, `listTransitions`, `transition`, `listHistoricalTransitions`,
`calculate`, `updateEntries`, and `split`. `client.orders` gains the B2B reads
`listForLegalEntity` and `getForLegalEntity`. All sales-order admin methods take
a required (service-token) auth; the legal-entity reads take a required customer
auth. Existing order methods are unchanged.
