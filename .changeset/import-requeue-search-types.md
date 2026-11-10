---
"@viu/emporix-sdk": minor
---

feat(sdk): queue a failed import file again, and document customer and legal-entity search

`client.imports.requeueStreamFile(streamId, fileId)` puts a `FAILED` file back at the end of a file-based stream's queue, so the next run reads the content the service already holds. It is not retried on a 5xx: a requeue that went through leaves the file `PENDING`, and a repeat answers `409`. The JSDoc of `triggerRun`, `retryRun` and the file-queue types now describes `lastProcessed` and the new `404` / `400` answers.

The Search Service accepts `customer` and `legal-entity` as a type besides custom schema types, with the matching read scopes; the `SearchService` JSDoc and the search docs say so, and describe index `analyzers` and `itemFields`. New type alias `SearchIndexAnalyzer`.
