---
"@viu/emporix-sdk": patch
---

docs(sdk): sync the search service spec for the CONTAINS filter

Search filters gain the `CONTAINS` operator: a case- and diacritic-insensitive substring match on a field indexed with `text: true`. It is available on `client.search.search` through `SearchFilterNode` without an SDK change. The search docs now list it, and their examples write the custom schema type in upper case (`VEHICLE`), as upstream does.
