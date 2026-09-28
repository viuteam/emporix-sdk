---
"@viu/emporix-sdk": major
---

feat(sdk): remove the Pick-Pack service — upstream End of Life

**Breaking: `client.pickPack` and every Pick-Pack type are gone.**

Emporix retired the Pick-Pack Service. It was deprecated on 2026-05-25 with
removal announced for 2026-08-24, and on 2026-09-16 all twelve endpoints and the
API reference were taken down — see "Pick-pack Service - removal of deprecated
endpoints" in the [Emporix changelog](https://developer.emporix.io/changelog)
and [emporix/api-references#497](https://github.com/emporix/api-references/pull/497).
The service's `@deprecated` marker in this SDK already announced the removal.

Nothing here could keep working: every `/pick-pack/{tenant}/…` operation —
orders, order cycles, assignees, packaging, packing events and recalculation
jobs — no longer exists. Keeping `client.pickPack` would have shipped a facade
that only ever answers 404 while looking like a working API, which is worse than
removing it.

Removed: the `pickPack` client property; `PickPackService` and its twelve
methods (`listOrders`, `getOrder`, `updateOrder`, `finishOrder`,
`listOrderCycles`, `addAssignee`, `removeAssignee`, `updatePackaging`,
`createEvent`, `listEvents`, `triggerRecalculation`, `getRecalculationJob`); the
types `PickOrder`, `PickOrderList`, `OrderStatusChange`, `PackagingProductsChange`,
`Assignee`, `OrderEntryEventCreate`, `PackingEvent`, `PackingEventList`,
`OrderCycleList`, `RecalculationJobInput`, `RecalculationJob`, `PickPackAck` and
`RecalculationJobCreated`; the generated types, the vendored spec, the
`"pick-pack"` logger channel and `docs/pick-pack.md`.

**If you used it:** there is no replacement in the Emporix API.

This also unblocks the `Emporix API Sync` workflow, which has failed on every run
since 2026-09-17 — `fetch-specs` requests each vendored spec and throws on a
non-200, so the 404 on `orders/pick-pack/api-reference/api.yml` stopped the whole
sync after 33 successful fetches and left the remaining nine unrequested. That fail-fast is deliberate and stays, as it
did for the SEPA Export removal in 3.0.0: a silently skipped spec would
regenerate types without a service and nobody would notice.
