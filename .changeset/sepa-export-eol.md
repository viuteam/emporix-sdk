---
"@viu/emporix-sdk": major
---

feat(sdk): remove the SEPA Export service — upstream End of Life

**Breaking: `client.sepaExport` and every `Sepa*` type are gone.**

Emporix retired the SEPA Export Service. It was deprecated on 2026-05-25 with
removal announced for 2026-08-24, and on that date the endpoints and the API
reference were both taken down — see the
[Emporix changelog](https://developer.emporix.io/changelog). The service's
`@deprecated` marker in this SDK already carried that removal date.

Nothing here could keep working: `GET /sepa-export/{tenant}/files/{id}`,
`GET /sepa-export/{tenant}/jobs` and `POST /sepa-export/{tenant}/jobs` no longer
exist. Keeping `client.sepaExport` would have shipped a facade that only ever
answers 404 while looking like a working API, which is worse than removing it.

Removed: the `sepaExport` client property, `SepaExportService`, its input and
result types, the generated types, the vendored spec, the `"sepa-export"` logger
channel and `docs/sepa-export.md`.

**If you used it:** there is no replacement in the Emporix API. Export
functionality has to come from somewhere other than this service.

This also unblocks the `Emporix API Sync` workflow, which had been failing on
every run since the takedown — `fetch-specs` requests each vendored spec and
throws on a non-200, so one 404 stopped the whole sync. That fail-fast is
deliberate and stays: a silently skipped spec would regenerate types without a
service and nobody would notice.
