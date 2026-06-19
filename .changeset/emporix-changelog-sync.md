---
"@viu/emporix-sdk": minor
---

Sync with the Emporix changelog (2026-06-18). New indexing reindex-jobs API:
`indexing.createReindexJob`, `indexing.listReindexJobs`, `indexing.getReindexJob`
(replacing the now-deprecated `indexing.reindex`). Deprecated `ragIndexer.reindex`
(use `indexing.createReindexJob({ entityType: "PRODUCT", rag: true })`), the whole
`SepaExportService` and `PickPackService`, and the deprecated approval price fields.
Availability is now fetched + vendored through the codegen pipeline. Adds upstream
version tracking: `specs/.sync-manifest.json` (written by `fetch-specs`) plus
`docs/emporix-upstream-changelog.md`.
