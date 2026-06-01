---
"@viu/emporix-sdk": minor
---

Add Emporix Brand and Label Service bindings via `client.brands` and
`client.labels`: full CRUD (`listBrands`/`getBrand`/`createBrand`/`updateBrand`/
`patchBrand`/`deleteBrand` and the label equivalents). Server-side only — these
use the service (clientCredentials) token; brand reads also work anonymously.
