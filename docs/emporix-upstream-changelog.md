# Emporix Upstream Changelog (SDK sync log)

Tracks which Emporix changelog entries (<https://developer.emporix.io/changelog>) have been
folded into this SDK, and when. The machine-readable companion is
`packages/sdk/specs/.sync-manifest.json` (per-service `sha256` + `fetchedAt`); run
`pnpm -F @viu/emporix-sdk fetch:specs` to see `changed since last vendored: …`.

## 2026-10-02 — release notes: Import Tool, cloud function hosting (no API change)

Two [product releases](https://developer.emporix.io/release-notes) with no API
change behind them, checked so the next sync does not have to:

- **Import Tool** — the Management Dashboard interface over the Import Service.
  Upstream `import-service` `api.yml` is byte-identical to the vendored copy; the
  API change that prepared it shipped on 2026-09-28 (below).
- **Cloud function hosting** — dashboard lifecycle features: descriptions and
  tags, a sandbox test, build history, and deleting a function now removes its
  deployments. The invocation endpoint that `client.cloudFunctions.invoke` wraps,
  `/cloud-functions/{tenant}/functions/{functionId}[/sub-path]`, is unchanged,
  and `emporix/api-references` has no spec for hosting management.

## 2026-09-30 — cart: command chain endpoint

Vendored by the bot's [#359](https://github.com/viuteam/emporix-sdk/pull/359);
the facade followed separately. Measured by path literal
(`coverage.mjs --spec cart`): 24 → **25** live operations. **1 new endpoint,
0 removed, 0 newly deprecated.** The facade covers all 25.

### Endpoints

- **cart** — `POST /cart/{tenant}/carts/{cartId}/execute` (customer token, or
  `cart.cart_manage`; `cart.cart_manage_external_prices` for external prices,
  products, fees or discounts) → `client.carts.execute`: runs up to ten existing
  cart operations on one cart in one request and answers `207` with one result
  per command. React: `useCartCommands`; Angular:
  `injectCartMutations().execute`. See [cart.md](./cart.md).

### Fields

Nothing else changed in `cart.yml`: the sync added one tag, the path and five
schemas (`executeRequest`, `executeCommand`, `executeCommandOptions`,
`executeResponse`, `executeCommandResult`).

### Behaviour

- `207` covers all-2xx chains **and** partial failures. With the default
  `onError=fail` the chain stops after the first non-2xx command, whose REST
  error body is its `data`; the SDK throws that error, and the commands before
  it are already applied.
- A whole-request `400` (no commands or more than ten, unknown type, bad
  `onError` / `versioning`, missing `resourceVersion` under
  `versioning=explicit`) means no command ran.
- The request takes about as long as its commands together; Emporix asks
  clients and gateways to size timeouts for the whole chain.

## 2026-09-28 — media: direct storage uploads and downloads

Vendored by the bot's [#347](https://github.com/viuteam/emporix-sdk/pull/347)
(types only, released in 4.0.1); the facade followed separately. Measured by
path literal (`coverage.mjs --spec media`): 7 → **9** live operations. **2 new
endpoints, 0 removed, 0 newly deprecated.** The facade covers all nine.

### Endpoints

- **media** — `POST /media/{tenant}/assets/upload-session`
  (`media.asset_manage` or `…_manage_by_vendor`) → `client.media.startUploadSession`:
  creates a `PENDING` BLOB asset and returns the storage request to send the file
  with — a signed Google Cloud Storage `PUT` or `POST` policy, or a Cloudinary
  form. `GET /media/{tenant}/assets/{assetId}/download-url` (`media.asset_read`,
  `…_read_by_vendor` or `…_manage_by_vendor`) → `client.media.getDownloadUrl`:
  a signed GCS URL for a private blob (15 minutes), the permanent Cloudinary URL
  for a public one, the stored URL for a link.

### Fields

| Where | Field | Note |
|---|---|---|
| asset | `status` (`PENDING` / `READY`) | only on BLOBs created through an upload session; absent means ready |
| OAuth scopes | `media.asset_read_by_vendor`, `media.asset_manage_by_vendor` | now declared in the spec |

### Behaviour

- **Direct upload is opt-in per tenant**, through Emporix Support. Without it the
  upload session answers `403` «direct upload is not enabled for this tenant» and
  creates nothing. The download URL does not depend on that setting.
- **The classic create and update accept 30 MB** instead of 10 MB.
- **The classic download** now documents `409` (asset still `PENDING`, file not
  in storage) and `413` (known size above the streaming limit, 30 MB by default),
  and Emporix recommends the download URL for every download. The `413` example
  message still says «10 megabytes».
- A `PENDING` asset whose file has arrived is completed by the download URL call
  or by retrieving the asset; `media.asset-created` fires only then.

## 2026-09-28 — import-service: published mappings for import runs

Vendored by the bot's [#345](https://github.com/viuteam/emporix-sdk/pull/345)
(types only) and documented on 2026-10-02. Measured by path literal
(`coverage.mjs --spec import-service`): 24 → **24** live operations. **0 new
endpoints, 0 removed, 0 newly deprecated.** The facade covers all 24.

### Fields

Nothing to build — they arrived through the type aliases. They did need
documenting:

| Where | Field | Note |
|---|---|---|
| `triggerRun` body | `mappings` (`published` / `draft`) | dry-run only, default `published`; no effect on a real run |
| run | `mappingVersions[]` | `{ streamId, version }`, fixed when the run starts; `0` = no published mappings; absent on a draft dry run and on older runs |
| run | `dryRunPublished` | which mappings a dry run used |
| run and stream status | `ABORTED` | refused because of the configuration; nothing read or written |

### Behaviour

- A run executes each stream's **published** mappings. Publishing needs
  `importtool.import_manage` and is not in the public API reference, so the SDK
  cannot do it; it happens in the Import Tool.
- A stream whose mappings were never published is not run: it is `ABORTED` in
  the run details, and the run finishes `PARTIAL`.
- **A refused run still answers `200`.** When `streamIds` names such a stream,
  or every enabled stream is one, `triggerRun` resolves with the run, which then
  finishes `ABORTED` with a `message` naming the streams. `retryRun` can end
  `ABORTED` the same way.
- A dry run with a `mappings` value other than `published` or `draft` answers
  `400`, with a Spring-style body (`timestamp`, `status`, `error`, `path`)
  instead of the usual error message. The SDK's type admits only the two values.

## 2026-09-14 … 2026-09-25 — segment IAM groups, import run diagnostics, AI attachment reuse

Vendored by a manual sync once the pick-pack removal (below) unblocked
`fetch-specs`; it supersedes the bot's sync PR, frozen at the 2026-09-16 state.
Five specs drifted. Measured by path literal:

| Spec | Live operations | New | Removed |
|---|---|---|---|
| customer-segment | 30 → **36** | 6 | 0 |
| import-service | 21 → **24** | 3 | 0 |
| ai-service | 57 → 57 | 0 | 0 |
| audit-logs-changelog | 1 → 1 | 0 | 0 |
| shipping | 44 → 44 | 0 | 0 |

**9 new endpoints, 0 removed, 0 newly deprecated.** The facade covers all of
them; every one of the five specs is at full coverage.

### Endpoints

- **customer-segment** (2026-09-16) — IAM group assignments: `GET`, `POST
  …/search`, and `GET`/`PUT`/`DELETE …/{groupId}` under
  `/segments/{segmentId}/groups` (`segment_read` / `segment_manage`). SDK:
  `client.segments.groups.{list,search,get,assign,remove}`. Only groups with
  `userType: CUSTOMER` can be assigned; the upsert answers `201`/`204` without a
  body. Plus `GET /segments/me` (`segment_read_own`): the customer's active
  segments, direct and inherited through groups — SDK: `client.segments.listMine`.
- **import-service** (2026-09-14, 2026-09-23) — `GET /configs/{configId}/stream-order`
  → `client.imports.getStreamOrder`; `GET /runs/{runId}/diagnostics` and
  `…/diagnostics/csv` → `client.imports.listRunDiagnostics` /
  `downloadRunDiagnosticsCsv`. Diagnostics are a capped sample: `limit`
  defaults to 500 for JSON and 50 000 for CSV.

### Fields

Nothing to build — they arrived through the type aliases. They did need
documenting:

| Where | Change | Note |
|---|---|---|
| `triggerRun` body | `streamIds` added | ids, not names — `getStreamOrder` reports names |
| import stream | `deleteConfig` documented | how source deletes propagate |
| import stream | `targetDeleteSubscriptionEnabled`, `onTargetReappear` **removed** | upstream no longer reacts to targets deleted outside the import; a type-level removal, allowed because the service is preview |
| AI request/session logs | `promptTokens`, `completionTokens` | per request, rolled up per session |
| AI agent responses | `handOff` deprecated | no longer used |
| audit-logs `q` | `entity:quote`, `entity:site` | quote and site history |

### Behaviour

- **AI attachment reuse** (2026-09-25) now answers `200` with `{ id, sessionId }`
  instead of `204`, accepts a JSON body besides the form field, and no longer
  requires the `session-id` header — without it the service opens a session and
  returns its id. `reuseAttachment` follows: it resolves to the attachment, and
  `sessionId` is optional. It keeps sending the form field.
- **AI cursor pagination** (2026-09-17) on agent request/session logs and jobs:
  `next`/`prev` plus `X-Next-Cursor`/`X-Prev-Cursor`. **Not exposed** — those
  facades return plain arrays, so the headers are dropped. Offset paging still
  works.
- **Webhook events** (2026-09-14, 2026-09-23): `client-management.location-*`
  and `customer.sign-up`. Not part of any vendored spec; nothing to change.

## 2026-09-16 — pick-pack: End of Life, service removed

Upstream [api-references#497](https://github.com/emporix/api-references/pull/497)
merged 13:10 UTC and deleted `orders/pick-pack` outright — the API reference and
all twelve `/pick-pack/{tenant}/…` endpoints, deprecated since 2026-05-25. The
SDK facade is removed in the same way SEPA Export was in 3.0.0; see the
`@viu/emporix-sdk` 4.0.0 changelog. **0 new endpoints, 12 removed** — the whole
spec.

The daily sync had run successfully at 11:20 UTC that day. From 2026-09-17 on it
failed on every run: `fetch-specs` throws on the 404 for the deleted spec, which
also stopped the vendoring of every other service behind it, so upstream changes
after 2026-09-16 are not on `main` yet and the open sync PR still holds the
2026-09-16 state.

The same Emporix changelog day removed the Supplier Service. Nothing to do here:
the SDK never vendored or wrapped it.

## 2026-09-10 — media: JSON Patch for assets; ai-service: reusable chat attachments

Vendored by a manual sync run; the facade follows in the same PR. Three specs
drifted — `media`, `ai-service` and `product` — and only one of them added an
operation. Measured by path literal: media 6 → **7**, ai-service 57 → 57,
product 17 → 17.

### Endpoints

- **media** — new `PATCH /media/{tenant}/assets/{assetId}`, an RFC-6902
  op-array (`add`/`remove`/`replace`), `204`, scopes `media.asset_manage` /
  `media.asset_manage_by_vendor`. SDK: added `client.media.patch`. **1 new
  endpoint, 0 removed, 0 newly deprecated.** It is the only way to change a
  `BLOB` asset's metadata without re-uploading the file, since
  `update(…, { kind: "blob" })` always replaces the bytes.
- **ai-service** — `POST /ai-service/{tenant}/agentic/{agentId}/attachments`
  changed shape rather than multiplying: the multipart body is now a `oneOf` of
  `attachment` (a file, `201` with the new id) or `attachmentId` (reuse,
  **`204`**). Exactly one, or `400`. SDK: added `client.ai.reuseAttachment` as a
  separate method — the response types differ (`Attachment` vs nothing) and the
  `session-id` header is required for the reuse but optional for the upload, so
  one overloaded call could not express either rule.

### Fields

| Where | Field | Note |
|---|---|---|
| media `RefId.type` | `AGENT` | new reference type; links a `PRIVATE` asset to an AI agent |

Nothing to build for that one — the facade aliases the generated types, so
`AssetRefId` accepted it with the sync.

### Prose only, but worth reading

**product** drifted with **no** schema and **no** operation change, and the
upstream changelog says nothing about it at all. What it added is the mixin
merge contract, which was previously undocumented and is easy to get backwards:

- `PATCH` (`products.update`) **merges** mixins. An omitted mixin name stays,
  sent fields merge recursively, and `null` stores `null` rather than deleting.
- So there is no way to delete a mixin through `PATCH`. That needs
  `PUT ?partial=false` (`products.replace`) with a complete document that omits
  the mixin from both `mixins` and `metadata.mixins`.
- Despite the verb, `PATCH` is **not** a JSON-Patch endpoint — an op-array of
  `{ op, path, value }` is rejected. (Media's new `PATCH`, confusingly, is.)

Both traps are now in the JSDoc of `products.update` and `products.replace`.

## 2026-09-06 — indexing-service: BATTERY_INCLUDED validates credentials before writing

Vendored by the scheduled sync (#327). **0 new endpoints, 0 removed, 0 newly
deprecated** — 11 operations before and after, and the vendored spec is
byte-identical to upstream. Verified by mapping operations on path literal, not
by count: the sync commit adds and removes zero `operationId` or path lines.
The facade already covers all 11, so nothing had to be built.

### Behaviour

On the `BATTERY_INCLUDED` provider, writes now validate the stored `indexName`
and `writeKey` against the search backend *before* taking effect:

| Case | Status | Effect |
|---|---|---|
| credentials invalid | `400` | nothing written, no job created |
| validation unreachable | **`502`** (new) | nothing written, no job created |

It applies to `POST`/`PUT /configurations`, `POST /reindex`, and
`POST /reindex-jobs` when `entityType` is `PRODUCT`. The generated types picked
up `502: ErrorMessage` on those four operations. The consequence for callers is
that **a `400` here may be about the write key rather than the request body**,
and the two are indistinguishable from the request alone — documented in the
`IndexingService` JSDoc and in [`docs/indexing.md`](./indexing.md).

### Fixed alongside

`listReindexJobs` never forwarded `sort`, which the spec has declared since the
2026-06-18 baseline and 11 other services expose. Pre-existing drift, unrelated
to this sync, fixed while the file was open.

## 2026-09-02 — schema-service: VENDOR_LOCATION

One enum value (#325), on the `type` filter of the schema reads and on
`SchemaType` itself. Nothing to build: `SchemaTypeName` is an alias of the
generated union, so the value became usable with the sync — the case the alias
pattern exists for.

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
