---
"@viu/emporix-sdk": minor
---

feat(sdk): forward sort on listReindexJobs and document the BATTERY_INCLUDED credential validation

`client.indexing.listReindexJobs({ sort })` now reaches the service. The spec has
declared `sort` on `GET /indexing/{tenant}/reindex-jobs` since the 2026-06-18
baseline sync and 11 other services already expose it, so this was drift rather
than a deliberate omission — the option existed nowhere in the SDK while every
neighbouring list method had it.

The rest is documentation for a behavioural change that arrived with the
2026-09-06 spec sync ([#327](https://github.com/viuteam/emporix-sdk/pull/327))
and added **no** new endpoints, which is why nothing in the facade had to move:
on the `BATTERY_INCLUDED` provider every write validates the stored `indexName`
and `writeKey` against the search backend before it takes effect.

- credentials invalid → `400`, nothing written and no job created
- validation temporarily unreachable → `502`, likewise nothing written

That covers `createConfiguration`, `updateConfiguration`, `reindex`, and
`createReindexJob` when `entityType` is `PRODUCT`. The practical consequence is
in the JSDoc and in `docs/indexing.md` now: **a `400` from these calls is not
necessarily a malformed body** — it may be the write key, and the two failures
are indistinguishable from the request alone.

`docs/indexing.md` also gained the reindex-jobs API it had been missing
entirely: it documented only the deprecated `reindex()` (removal 2026-12-01),
never `createReindexJob` / `listReindexJobs` / `getReindexJob`, so it pointed
readers at the endpoint that is going away. It now also notes that every field
on `ReindexJob` is optional in the spec, `id` included, so a returned job has to
be narrowed before it can be polled.
