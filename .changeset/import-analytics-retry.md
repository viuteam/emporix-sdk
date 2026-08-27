---
"@viu/emporix-sdk": minor
---

feat(sdk): add the import analytics reads and failed-record retry

Five operations Emporix added to the Import Service on 2026-08-26 ([changelog](https://developer.emporix.io/changelog#import-service-analytics-and-failed-record-retry)),
all on the `importtool.import_trigger` scope the rest of that surface already uses:

- `client.imports.stats(query?)` — aggregated analytics: totals, a time series,
  an error breakdown, per-stream health and stream changes. `sections` decides
  which the service computes, so name what you render.
- `client.imports.listJobGroups()` — the dashboard's job groups, configurations
  with their runs grouped under them.
- `client.imports.getHealthThresholds()` — the error rates above which a stream
  counts as degraded or failing in `stats`. Read-only; changing them needs
  `importtool.import_manage`.
- `client.imports.getLicense()` — import limits and current consumption.
- `client.imports.retryRun(runId)` — re-process only a run's failed records.

**`retryRun` returns a new run**, not a mutated original: its `id` differs and
`retry` is `true`. Poll it with `getRun` or follow it with `streamRun` exactly as
you would a triggered run. Like `triggerRun` it is not retried on a 5xx — a POST
that timed out may already have queued the retry.

The types for all five had already arrived with the spec sync, so this is the
facade catching up rather than new modelling. That is also why the gap was easy to
miss: a sync PR looks like a types-only diff, and five operations sitting there
without a wrapper show up in no diff at all.

Nothing was needed for the seven endpoints the same release *changed*. This
package's facade types are aliases of the generated ones, so the added response
fields — `aiEnabled`, `version`, `healthThresholds`, `createdBy` on a config, and
`retry` / `force` / `dryRun` on a run — were already reachable, as was `force` on
`triggerRun`'s body. Only that body's JSDoc was stale and now names all three
fields.

Upstream still marks the whole Import Service as preview; every new method says
so, like its neighbours.
