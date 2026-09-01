# Emporix Upstream Changelog (SDK sync log)

Tracks which Emporix changelog entries (<https://developer.emporix.io/changelog>) have been
folded into this SDK, and when. The machine-readable companion is
`packages/sdk/specs/.sync-manifest.json` (per-service `sha256` + `fetchedAt`); run
`pnpm -F @viu/emporix-sdk fetch:specs` to see `changed since last vendored: …`.

## 2026-09-01 — import-service: removing a schedule, run origin, dry-run sample

Upstream [api-references#509](https://github.com/emporix/api-references/pull/509),
landed 12:48 UTC — 76 minutes after that morning's scheduled sync had correctly
reported import-service unchanged. Vendored by a manual sync run (#319); the
facade follows here.

### Endpoints

- **import-service** — new `DELETE …/configs/{configId}/schedule`
  (`deleteSchedule`, `importtool.import_trigger`). SDK: added
  `client.imports.deleteSchedule`. **1 new endpoint, 0 removed, 0 newly
  deprecated.** The facade now covers all 21 operations.

### Fields

Nothing to build — the facade types alias the generated ones, so these arrived
with the sync. They did need documenting:

| Where | Field | Note |
|---|---|---|
| `triggerRun` body | `sampleSize` | dry-run only, 1–100, default 25 |
| `triggerRun` body | `origin` | free text ≤40 chars; **rejected, not truncated** |
| run response | `dryRunSample[]` | the records a dry run would have written |
| run response | `origin` | echo; absent on older runs |

`setSchedule` also gained a documented `400` (cron/timezone unusable) and `404`
(no such configuration). The `400` names the six-field trap — the five-field
`0 * * * *` was previously stored and then silently never fired. The SDK already
documented six fields, so no behaviour changed.

One thing the spec does not answer: `sourceIssues` was added to the `stats`
response, but the `sections` parameter still documents only
`TOTALS,STREAMS,ERRORS,CHANGES`. Whether a section gates it is unstated, so the
docs tell callers to read it defensively.

## 2026-09-01 — registered the Audit Logs (Changelog) Service

A service that was never in the fetch registry, not a change to one that was:
`utilities/audit-logs-changelog`. Vendored, generated, and wrapped as
`client.auditLogs` — see [`docs/audit-logs.md`](./audit-logs.md).

| Service | Upstream path | Operations |
|---|---|---|
| Audit Logs (Changelog) | `utilities/audit-logs-changelog` | 1 (`GET /changelog/{tenant}/changelogs`) |

The spec needed no patching, and the whole surface is **one paginated read**.
The SDK now vendors **44** services.

Two behaviours worth knowing, both documented only in the spec's prose rather
than in its schema: a query without a conjunctive `occurredAt` lower bound gets
a silent **30-day trailing window**, and `entityId` without `entity` is a `400`
rather than an empty page.

The same fetch run also showed drift in `import-service` (new `duplicateKeys` /
`unresolvedParents` counters and a `sourceIssues` array on `stats`). That is not
part of this entry — the scheduled api-sync had already vendored it, which is
the arrangement working as intended: the daily job carries drift, feature
branches carry services.

## 2026-07-24 — registered the 5 remaining specs

Audited `fetch-specs.ts` against Emporix's
[list of API services](https://developer.emporix.io/api-references/quickstart/list-of-api-services)
and the `emporix/api-references` repo tree. Five services had **no vendored
spec** and were added to the fetch registry (vendored + generated types):

| Service | Upstream path | Note |
|---|---|---|
| OAuth Service | `authentication/oauth-service` | |
| Site Settings Service | `configuration/site-settings-service` | backs the hand-written `site` service |
| Invoice Service | `orders/invoice` | `api.yaml` extension |
| Quote Service | `quotes/quote` | `api.yaml` extension |
| Session Context Service | `users-and-permissions/session-context` | backs the hand-written `session-context` service |

Three upstream specs use an `api.yaml` (not `.yml`) extension — the reason they
were missed by earlier audits. The SDK now vendors **all 43** listed services.

**Facades (follow-up):** `site` and `session-context` already had services (now
backed by the generated types). Added `client.invoices` (invoice-generation
jobs) and `client.quotes` (quotes CRUD + PDF + history, with a
`client.quotes.reasons` config sub-resource). **oauth-service is intentionally
not wrapped** — its only endpoint is the `POST /oauth/token` client-credentials
grant, which the SDK auth core (`DefaultTokenProvider`) already owns; a second
public path would duplicate it.

## 2026-07-24 — synced (ai-service full parity)

Re-vendored specs; only `ai-service` changed (**6 new endpoints, 0 removed, 0
newly deprecated**) — the OAuth-config CRUD. Alongside the sync, the SDK's
`AiService` facade was brought to **full parity** with the ai-service spec.

### Endpoints

- **ai-service** — new `…/agentic/oauths` CRUD (list/search/get/upsert/patch/delete).
  SDK: added `ai.oauths`, plus the previously-unbound `ai.tools`, `ai.tokens`,
  `ai.mcpServers` (CRUD), `ai.jobs`, `ai.templates`, `ai.logs`, `ai.analytics`,
  and `ai.listModels` / `ai.listCommerceEvents` / `ai.uploadAttachment` /
  `ai.exportAgents` / `ai.importAgents`. 44 operations total.

## 2026-07-21 — synced (agentic streaming + conversations)

Re-vendored all specs; 13 changed. **5 new endpoints, 0 removed, 0 newly
deprecated.** Also fixed a transient upstream defect in `schema.yml` (see the
generation-hardening work in the api-sync workflow); the defect was later
corrected upstream, so no local spec patch remains active.

### Endpoints

- **ai-service** — new `POST …/agentic/chat-stream` (Server-Sent Events),
  `GET …/agentic/conversations`, `POST …/agentic/conversations/search`. SDK:
  added `ai.chatStream` (backed by the new `HttpClient.requestStream` SSE core
  capability), `ai.listConversations`, `ai.searchConversations`.
- **category** — new `POST …/category-trees/{rootCategoryId}/rebuild`. SDK:
  added `category.rebuildTree`.
- **schema** — new `PATCH …/custom-entities/{type}/instances/bulk`. SDK: added
  `schema.bulkPatchInstances` (207 per-item results).

### Tracked, no SDK action

- The 11 endpoints carrying `deprecated: true` were all already deprecated at
  the 2026-06-18 baseline. The two the SDK wraps (`indexing.reindex`,
  `ragIndexer.reindex`) already carry `@deprecated`; the 8 `iam` ones have no
  facade. `category.tree` already targets the non-deprecated `/category-trees`.

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
