---
"@viu/emporix-sdk": minor
---

feat(sdk): manage the file queue of a file-based import stream

The Import Service can now read delimited files (CSV and its variants). Five new `client.imports` methods manage a stream's file queue: `listStreamFiles`, `uploadStreamFile` (multipart, `fileName` required), `getStreamFileLimits`, `setStreamFileOrder` and `deleteStreamFile`, with the new types `ImportFile`, `ImportFileStatus`, `ImportFileQueue` and `ImportFileUploadLimits`. An upload is not retried on a 5xx, because the service dedupes on the content hash and a repeat of an upload that went through answers `409`.

The vendored spec also brings the reconciled run counters (`collapsed`, `embedded`), `filesRead` / `fileNames` on run streams, `sourceDataset` and `fileMode` on streams, and documented error codes including `CONFIGURATION`, `EXTERNAL_SYSTEM` and `REJECTED_BY_SOURCE`. They arrive through the existing type aliases.
