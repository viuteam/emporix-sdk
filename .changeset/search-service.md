---
"@viu/emporix-sdk": minor
---

feat(sdk): add the search service

New `client.search` (`SearchService`) over Emporix's Search Service, which is in preview and supports custom schema types only: `search` runs a direct or a saved search on one type, `listSavedSearches` / `getSavedSearch` / `upsertSavedSearch` / `deleteSavedSearch` manage saved searches, `listIndexes` / `getIndex` / `upsertIndex` / `deleteIndex` manage the indexes, and `listJobs` / `getJob` track the jobs that build them. Both lists span every type unless `type` is given. The upserts resolve to the created id (or the build job's id) and to `undefined` when nothing new was created. Server-side; defaults to the service token.
