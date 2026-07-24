---
"@viu/emporix-sdk": minor
---

Add category admin CRUD to `client.categories`: core writes
(`create`/`update`/`patch`/`delete`), POST-body search (`searchByQuery`,
`searchTrees`), and a `categories.assignments` sub-resource — `list`,
`create`, `bulkCreate`, `remove`, `removeAll`, reference-based
`upsertByReference`/`removeByReference`/`bulkUpsertByReference`, and
tenant-wide `listCategoriesByReference`/`removeAllByReference`. Writes default
to service auth (overridable). The existing storefront reads are unchanged.
