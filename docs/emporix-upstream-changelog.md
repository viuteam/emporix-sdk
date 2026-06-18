# Emporix Upstream Changelog (SDK sync log)

Tracks which Emporix changelog entries (<https://developer.emporix.io/changelog>) have been
folded into this SDK, and when. The machine-readable companion is
`packages/sdk/specs/.sync-manifest.json` (per-service `sha256` + `fetchedAt`); run
`pnpm -F @viu/emporix-sdk fetch:specs` to see `changed since last vendored: …`.

## 2026-06-18 — synced (reindex-jobs migration + deprecation sweep)

Baseline sync; vendored all 38 specs and wrote the initial sync manifest.

### Endpoints

- **indexing** — `POST /indexing/{tenant}/reindex` deprecated (removal **2026-12-01**); new
  `POST /indexing/{tenant}/reindex-jobs` (+ `GET …/reindex-jobs`, `GET …/reindex-jobs/{id}`).
  SDK: added `indexing.createReindexJob` / `listReindexJobs` / `getReindexJob`; `@deprecated`
  on `indexing.reindex`.
- **ai-rag-indexer** — `reindex` deprecated (removal **2026-12-01**) → use indexing
  `reindex-jobs` with `rag: true`. `filter-metadata` response fields `name`/`description`
  deprecated. SDK: `@deprecated` on `ragIndexer.reindex` (already noted on the filter fields).

### Whole services

- **sepa-export** — all endpoints deprecated (removal **2026-08-24**). SDK: `@deprecated` on
  `SepaExportService`.
- **pick-pack** — all endpoints deprecated (removal **2026-08-24**). SDK: `@deprecated` on
  `PickPackService`.

### Fields

- **approval** — `totalPrice.amount`, `subTotalPrice.amount`, `itemYrn`, `itemPrice.amount`
  deprecated (removal **2026-11-30**) → `netValue`/`grossValue`/`taxValue`, `itemId`,
  `calculatedPrice`+`unitPrice`. SDK: carried via generated `@deprecated`; documented in
  `approval-types.ts`.

### Tracked, no SDK action

- **availability** — only the *location-management* endpoints are deprecated (removal
  **2026-09-01**); the SDK does not wrap them. The product availability endpoints used by
  `availability.get` / `getMany` are current (the availability spec is now fetched + vendored).
- **supplier** — whole service deprecated (removal **2026-09-01**). No SDK surface.
- **iam** — roles/permissions/resources model deprecated (removal **2026-10-01**). No SDK
  surface (the iam spec is vendored but not wrapped).
