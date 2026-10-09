---
"@viu/emporix-sdk": minor
---

feat(sdk): add search index export and import

`client.search.exportIndexes(selections)` packs the configuration of the selected search indexes, and `client.search.importIndexes(pkg)` creates or updates each of them, typically on another tenant, resolving to one result per index with the build job's id when one started. The import is not atomic: indexes before a failing one stay written. `upsertIndex` no longer needs `metadata.version` on an update; when sent, it still guards against a stale write with `409`.
