---
"@viu/emporix-sdk": minor
---

feat(sdk): add import deleteSchedule and document the new run fields

Wraps the one operation Emporix added to the Import Service on 2026-09-01
([api-references#509](https://github.com/emporix/api-references/pull/509)) and
documents the three request/response fields that came with it.

- `client.imports.deleteSchedule(configId)` — remove a configuration's schedule
  so it runs only when triggered. **Idempotent, and deliberately not gated on
  the configuration existing**: removing a schedule that is not there resolves
  just the same, and unlike `setSchedule` the configuration need not still be
  around. That asymmetry is the point — a schedule left behind by a deleted
  configuration is precisely what needs removing. Resolves to `void` (`204`).

The other additions needed no new code, because this package's facade types
alias the generated ones — but they did need documenting, since none of them is
discoverable from a type:

- `triggerRun` accepts `sampleSize` (dry-run only, 1–100, default 25) and the
  run comes back with `dryRunSample`: the mapped records the import *would* have
  written, so a mapping can be previewed without one. Absent on a normal run.
- `triggerRun` accepts `origin`, free text naming *what* asked for the run, and
  the run echoes it. `trigger` only records `MANUAL` or `SCHEDULED`, so without
  `origin` a dashboard click and an integration scenario are indistinguishable
  in the history. **Over 40 characters, or containing control characters, is
  rejected rather than shortened** — a truncated label in an audit trail is
  worse than a refused request.
- `setSchedule` now documents `400` and `404`. The `400` names the six-field
  cron trap explicitly: the familiar five-field `"0 * * * *"` is not «hourly»,
  it is invalid — and the service used to store it and then silently never fire
  it. The SDK already required six fields, so this is now stated where the call
  is made rather than only on the type.

`ImportRun`'s and `ImportRunInput`'s JSDoc were stale by one release and now
name every field, including the `duplicateKeys` / `unresolvedParents` source-feed
counters — a run can report `SUCCEEDED` with both non-zero, which is exactly why
they are worth reading.

With this the facade covers all 21 operations of the vendored spec.
