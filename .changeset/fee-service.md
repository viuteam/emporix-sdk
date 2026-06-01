---
"@viu/emporix-sdk": minor
---

Add Fee Service bindings: `client.fees` provides CRUD over fee definitions
(`list`/`get`/`create`/`update`/`delete`) plus item- and product-fee mappings
(`listItemFees`/`getItemFees`/`createItemFee`/`setItemFees`/`deleteItemFees`/
`searchItemFees`, `getProductFees`/`setProductFees`/`deleteProductFees`).
Server-side only — these use the service (clientCredentials) token and must not
be called from a browser.
