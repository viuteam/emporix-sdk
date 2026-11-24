---
"@viu/emporix-sdk": minor
---

feat(sdk): add auditLogs.listByCursor for the audit log's cursor pagination

The Audit Logs (Changelog) Service can now page by cursor. `client.auditLogs.listByCursor({ q, pageSize, next, prev })` sends `pagination=cursor` and returns an `AuditLogCursorPage` with `items`, `hasNextPage`, and the `nextCursor` (older entries) / `prevCursor` (newer entries) read from the `x-next-cursor` / `x-prev-cursor` response headers. Cursor mode skips counting, so the page carries no totals. A cursor is bound to the `q` and `pageSize` it was issued with; changing either is a `400`. `auditLogs.list` is unchanged and stays in offset mode.

Behaviour change upstream: the service's default time window, applied when `q` has no `occurredAt` lower bound, shrank from 30 to 7 days in both modes. An unfiltered `auditLogs.list()` now returns only the last week — add an explicit `occurredAt` range if you relied on the last month. The JSDoc and `docs/audit-logs.md` are updated, and `docs/import.md` now documents XML files for file-based import streams.
