---
"@viu/emporix-sdk": patch
---

docs(sdk): sync the import service spec for queued import runs

Emporix now queues import runs. `client.imports.triggerRun` and `retryRun` return the run `QUEUED` instead of `RUNNING`, answer `409` while the configuration already has a run `QUEUED`, `RUNNING` or `RESUMABLE`, and no longer answer `429` when `maxConcurrentImports` is reached — the run waits instead. `ImportRun` gains the `RESUMABLE` status, `executionStartedAt`, `queueWaitingFor`, `queuePosition`, `supersededRequests` and `lastRequestedAt`; `startedAt` now means when the run was requested, and `mappingVersions` is absent while a run is queued. `cancelRun` stops a `RESUMABLE` run only with `force: true`. Code that waits for `RUNNING` after triggering a run must accept `QUEUED` too.
