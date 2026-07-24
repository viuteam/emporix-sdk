---
"@viu/emporix-sdk": minor
---

Add customer-segment admin CRUD to `client.segments`: segment core
(`create`/`search`/`update`/`patch`/`delete`/`match` + `bulkCreate`/`bulkUpdate`/`bulkDelete`),
`segments.customers` (list/search + B2C & B2B assign/remove + bulk), and
`segments.items` (search + assign/remove per PRODUCT/CATEGORY + bulk). Every
admin method defaults to `service` auth (override allowed). The existing
storefront read methods are unchanged.
