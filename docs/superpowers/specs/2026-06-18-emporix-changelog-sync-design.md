# Emporix Changelog Sync (2026-06-18) + Upstream Version Tracking — Design

- **Date:** 2026-06-18
- **Status:** Approved (design), pending implementation plan
- **Packages affected:** `@viu/emporix-sdk` (primary)
- **Related:** `packages/sdk/scripts/fetch-specs.ts`, `packages/sdk/scripts/generate.ts`, Emporix changelog <https://developer.emporix.io/changelog>

## Problem

The Emporix Commerce Engine publishes API changes on its changelog
(<https://developer.emporix.io/changelog>). As of **2026-06-18** several endpoints the SDK
wraps are now **deprecated** upstream, the most recent being the reindex migration:

- `POST /indexing/{tenant}/reindex` → replaced by `POST /indexing/{tenant}/reindex-jobs`
  (a job-based API with progress tracking). Removal **2026-12-01**.
- `POST /ai-rag-indexer/{tenant}/{type}/reindex` → replaced by the same indexing
  `reindex-jobs` endpoint (with `rag: true`). Removal **2026-12-01**.

Additional currently-open deprecations affect, or are adjacent to, the SDK surface (see the
scope map below). Two gaps make this hard to manage well:

1. **No version watermark.** The SDK vendors OpenAPI specs under `packages/sdk/specs/*.yml`
   but records nothing about *which upstream revision* is vendored or *when* it was fetched.
   There is no way to answer "what changed upstream since we last synced?" without manually
   diffing.
2. **Deprecations are invisible to consumers.** Deprecated endpoints/fields are not flagged in
   the hand-written service layer, so SDK users get no `@deprecated` signal in their IDE and no
   migration pointer.

## Goals

- Add the new indexing **reindex-jobs** API (full job surface) and mark the old reindex
  endpoints `@deprecated` with migration pointers.
- Bring every SDK-visible deprecation from the changelog into the service layer as `@deprecated`
  JSDoc (services, fields, methods) with removal dates and replacements.
- Regenerate entities from the (re-fetched) upstream schemas, including wiring the
  **availability** spec into the generated pipeline.
- Establish **upstream version tracking** so future syncs can compute "what changed since when":
  a machine-readable sync manifest plus a human-readable upstream changelog doc.

## Non-Goals

- Removing any deprecated endpoint/field (all upstream removal dates are in the future; removal
  would be a breaking change handled in a later major).
- Wrapping services the SDK does not currently expose (IAM, Supplier) — tracked in the doc only.
- Changing `packages/react` hooks (no React surface is affected by these deprecations).

## Scope Map (changelog → SDK action)

| Emporix entry (date) | Removal | SDK action |
|---|---|---|
| indexing `POST /reindex` → `reindex-jobs` (06-18) | 2026-12-01 | Regen indexing spec; **add** `createReindexJob` / `listReindexJobs` / `getReindexJob` + entity aliases; `@deprecated` on `reindex()` |
| ai-rag-indexer `reindex` → indexing reindex-jobs (06-18) | 2026-12-01 | `@deprecated` on `RagIndexerService.reindex()`, pointing to `indexing.createReindexJob({ entityType: "PRODUCT", rag: true })` |
| ai-rag-indexer `filter-metadata` fields `name`/`description` (05-25) | 2026-12-01 | Regen carries upstream `deprecated`; reaffirm existing docstring in `ai-rag-indexer-types.ts` |
| sepa-export — whole service (05-25) | 2026-08-24 | `@deprecated` on `SepaExportService` class |
| pick-pack — whole service (05-25) | 2026-08-24 | `@deprecated` on `PickPackService` class |
| approval fields (`totalPrice.amount`, `subTotalPrice.amount`, `itemYrn`, `itemPrice.amount`) (05-26) | 2026-11-30 | Regen approval spec (carries upstream `deprecated`); document replacements in `approval-types.ts` aliases |
| availability — `site`-query endpoints → `site`-path; location mgmt endpoints (05-28) | 2026-09-01 | Wire availability into `fetch-specs.ts`; regen; migrate `getMany()` to `POST /availability/{tenant}/availability/site/{site}`; `@deprecated` on old query-param path |
| supplier — whole service (05-28) | 2026-09-01 | **No SDK service** → record in tracking doc only |
| iam — roles/permissions/resources (05-13) | 2026-10-01 | **No SDK service** → record in tracking doc only |

**Locations clarification:** the SDK's `src/services/locations.ts` is the **B2B customer
locations** service (customer-management: legal entities / contacts / locations), *not* the
availability location-management endpoints the changelog deprecates. `locations.ts` is **not
touched** by this work.

## Architecture

The existing codegen pipeline is the backbone and is unchanged in shape:

```
scripts/fetch-specs.ts  →  specs/<svc>.yml  →  scripts/generate.ts (hey-api)  →  src/generated/<svc>/types.gen.ts
                                                                                          ↑ never hand-edited
hand-written services (src/services/<svc>.ts)  alias generated types in <svc>-types.ts and add methods / @deprecated JSDoc
```

Two additions:

1. A **sync manifest** written by `fetch-specs.ts`.
2. A **curated upstream changelog doc** maintained by hand.

### 1. Indexing reindex-jobs surface

New public type aliases in `src/services/indexing-types.ts` over the regenerated
`indexing-service` types:

```ts
export type ReindexJob        = Gen.ReindexJob;        // { id?, entityType?, message?, status?, metadata? }
export type ReindexJobInput   = Gen.ReindexRequest;    // { entityType: string; rag?: boolean }  (entityType required)
export type ReindexEntityType = Gen.ReindexEntityType; // string — "PRODUCT" + custom schema types
export type ReindexJobStatus  = Gen.ReindexJobStatus;  // 'FAILURE' | 'IN_PROGRESS' | 'PENDING' | 'SUCCESS'
/** @deprecated since 2026-06-18, removal 2026-12-01 — use ReindexJobInput / createReindexJob */
export type ReindexInput      = Gen.Reindex;
```

New methods on `IndexingService` (`src/services/indexing.ts`), default auth `service` (matches
existing methods; the endpoint needs the `indexing.search_manage` scope):

```ts
createReindexJob(input: ReindexJobInput, auth?): Promise<ReindexJob>   // POST /indexing/{tenant}/reindex-jobs
listReindexJobs(opts?: { pageNumber?; pageSize?; q? }, auth?): Promise<PaginatedItems<ReindexJob>>  // GET …/reindex-jobs
getReindexJob(reindexJobId: string, auth?): Promise<ReindexJob>        // GET …/reindex-jobs/{reindexJobId}

/** @deprecated since 2026-06-18, removal 2026-12-01 — use createReindexJob */
reindex(input: ReindexInput, auth?): Promise<void>                     // kept, POST …/reindex
```

`listReindexJobs` follows the established `PaginatedItems<T>` convention (default
`pageNumber = 1`, `pageSize = 50`; `hasNextPage` inferred from a full page), mirroring
`OrdersService.listMine`. The upstream `POST /reindex-jobs` returns `201` for a new job or
`200` when a job for that `entityType` is already `IN_PROGRESS`; both bodies are `ReindexJob`,
so the method resolves to `ReindexJob` in either case.

### 2. RAG indexer + service-wide + field deprecations

- `RagIndexerService.reindex()` gets `@deprecated` JSDoc pointing to
  `client.indexing.createReindexJob({ entityType: "PRODUCT", rag: true })`. The method body is
  unchanged (the spec models it as `GET` but the SDK calls `POST`; that pre-existing quirk is
  left as-is, only the deprecation notice is added).
- `SepaExportService` and `PickPackService` get class-level `@deprecated` JSDoc with their
  removal dates.
- `approval-types.ts` aliases document the deprecated `*.amount` / `itemYrn` / `itemPrice.amount`
  fields and their replacements (`netValue`/`grossValue`/`taxValue`, `itemId`, `calculatedPrice`
  + `unitPrice`). The generated types already carry, or will carry after regen, the upstream
  `@deprecated` markers; the alias layer surfaces them with migration guidance.

### 3. Availability — full pipeline wiring

The availability spec is currently **manually vendored** (`specs/availability.yml`, a minimal
hand-written v0.0.1) and is **absent** from `fetch-specs.ts`. The real upstream spec lives at
`orders/availability/api-reference/api.yml`.

Changes:

1. Add availability to `fetch-specs.ts`:
   `availability: ${BASE}/orders/availability/api-reference/api.yml`.
2. Regenerate `src/generated/availability/types.gen.ts` from the real upstream spec, replacing
   the minimal vendored types.
3. **Introduce `src/services/availability-types.ts`** (the service currently imports
   `AvailabilityWithBundle` directly from the generated module). The alias layer keeps the
   stable public name `Availability` decoupled from whatever the regenerated schema names are —
   the exact upstream schema names are resolved during implementation by reading the freshly
   generated file.
4. Migrate `getMany()` from the deprecated query-param search
   (`POST /availability/{tenant}/availability/search?site=`) to the new path-param endpoint
   `POST /availability/{tenant}/availability/site/{site}`. Preserve the existing public
   signature/return shape where possible; if a behavioural change is unavoidable, keep the old
   call path available under a `@deprecated` method and add the new one. `get()` already uses
   the path-param form and only needs type reconciliation.

**Risk:** regenerating availability replaces the hand-vendored types, so `availability.ts`'s
type imports must be reconciled against the new generated names. This is the main integration
risk and is handled explicitly in the implementation plan (regen → read generated names → build
aliases → adjust service → typecheck).

### 4. Sync manifest (machine-readable watermark)

`scripts/fetch-specs.ts` writes `packages/sdk/specs/.sync-manifest.json` after each run:

```jsonc
{
  "generatedAt": "2026-06-18T00:00:00.000Z",
  "services": {
    "indexing-service": {
      "url": "https://raw.githubusercontent.com/emporix/api-references/refs/heads/main/configuration/indexing-service/api-reference/api.yml",
      "specVersion": "v1",          // from the spec's info.version (may be "" upstream)
      "fetchedAt": "2026-06-18T00:00:00.000Z",
      "sha256": "<hex of the fetched yaml bytes>"
    }
    // … one entry per service in SPECS, including availability
  }
}
```

On each run the script reads the prior manifest (if present), and after fetching logs which
services' `sha256` changed since the last vendored revision:

```
changed since last vendored: indexing-service, ai-rag-indexer, approval-service, availability
```

This is the machine-readable answer to "what changed upstream, and when did we last sync?".
`fetch-specs.ts` is a Node script, so `new Date()`/hashing are available (no workflow-runtime
restrictions apply here). The manifest is committed alongside the regenerated specs.

### 5. Curated upstream changelog (human-readable)

`docs/emporix-upstream-changelog.md` is a hand-maintained log. Each entry is dated by the
Emporix changelog date and records: what was deprecated/added upstream, the SDK's reaction, and
the removal date. The first entry covers everything in the scope map above, including the
"no SDK surface — no action" notes for supplier and iam. Example shape:

```md
## 2026-06-18 — indexing & ai-rag-indexer reindex → reindex-jobs
- Upstream: POST /indexing/{tenant}/reindex deprecated (removal 2026-12-01); new POST …/reindex-jobs.
- Upstream: ai-rag-indexer reindex deprecated (removal 2026-12-01) → use indexing reindex-jobs.
- SDK: added createReindexJob/listReindexJobs/getReindexJob; @deprecated on indexing.reindex and ragIndexer.reindex.
```

## Error Handling

No new error semantics. New methods use the shared `ctx.http.request` path, inheriting the
SDK's existing error mapping (e.g. `EmporixNotFoundError` for 404 on `getReindexJob`). The
`200`-vs-`201` duality of `createReindexJob` is normalised to a resolved `ReindexJob` (both
carry the same body). Deprecation is documentation-only and changes no runtime behaviour.

## Testing

- **New** `packages/sdk/tests/indexing.test.ts` (there are currently no indexing tests): MSW
  coverage for `createReindexJob` (201 and the 200 already-in-progress case), `listReindexJobs`
  (pagination shape), and `getReindexJob` (including 404 → `EmporixNotFoundError`).
- **Availability** tests for the migrated `getMany()` hitting the new `…/availability/site/{site}`
  path, plus `get()` after type reconciliation.
- A small test for the manifest writer asserting stable shape and that a changed spec body
  yields a changed `sha256` / appears in the "changed" report.
- Full gate: `pnpm -F @viu/emporix-sdk build`, `pnpm -r test`, `pnpm typecheck`.
- A `pnpm changeset` entry describing the user-visible additions (reindex-jobs methods) and the
  deprecations.

## Rollout / Sequencing

1. Wire availability into `fetch-specs.ts`; add the manifest writer.
2. Run the full `fetch-specs` + `generate` pass; commit regenerated specs, manifest, and types.
3. Indexing reindex-jobs (types + methods + tests).
4. Availability reconciliation + `getMany` migration + tests.
5. Deprecation JSDoc sweep (rag-indexer, sepa-export, pick-pack, approval, indexing.reindex).
6. Curated `docs/emporix-upstream-changelog.md` + changeset.
7. Verify (build, test, typecheck), then PR per the repo's branch/changeset flow.

## Open Questions

- Exact regenerated schema names for availability (resolved by reading the generated file during
  implementation; the alias layer absorbs whatever they are).

## Resolved Decisions

- `listReindexJobs` follows the existing `PaginatedItems` convention **without** a `total`
  field (the `X-Total-Count` header is not surfaced) — confirmed 2026-06-18.
