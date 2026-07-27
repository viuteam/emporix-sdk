---
"@viu/emporix-sdk": minor
---

Close the last API-coverage gaps. `client.companies` gains `search` (POST
`/legal-entities/search`) and `parentHierarchy`; `client.contacts` gains `get`.
`client.fees` gains `deleteProductFee` (removing a single fee from a product,
next to the existing `deleteProductFees` which clears all) plus
`searchItemFeesByProductId` and `searchItemFeesByProductIds` — note these two
search bodies are asymmetric upstream (`siteCodes: string[]` vs a single
`siteCode`, and `productIds` as a comma-separated string), which the SDK mirrors
verbatim. `client.tenantConfig` gains `listGlobal` and `client.clientConfig`
gains `listClients`. Every service keeps its existing auth convention.
