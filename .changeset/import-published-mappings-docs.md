---
"@viu/emporix-sdk": patch
---

docs(sdk): document published mappings and aborted import runs

The import types and `triggerRun` / `retryRun` now describe the Import Service change of 2026-09-28, which the types already carried: a run executes each stream's published mappings, a dry run checks the drafts with `mappings: "draft"`, and runs report `mappingVersions` and `dryRunPublished`. They also name the trap that came with it — a run refused for never-published mappings still resolves with `200` and only then finishes `ABORTED`, so read the run back before treating it as started.
