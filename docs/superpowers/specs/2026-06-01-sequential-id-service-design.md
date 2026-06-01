# Sequential ID Service Binding — Design

- **Date:** 2026-06-01
- **Status:** Approved (design); pending implementation plan
- **Package:** `@viu/emporix-sdk` (core only)
- **Branch:** `feat/sequential-id-service`

## 1. Context & motivation

The SDK exposes one service binding per Emporix Commerce Engine service. The
**Sequential ID Service** (`/sequential-id/{tenant}/…`) is not yet bound. It
generates human-readable, gap-free sequential identifiers (order numbers,
invoice numbers, etc.) from server-managed counters. A tenant defines one or
more **sequence schemas** (a counter template with pre/post text, padding, and
a start/max range); callers then request the next id for a schema type, with
optional placeholder substitution and per-key sub-pools.

This design adds bindings for the schema CRUD/admin endpoints **and** the
id-generation endpoints as a **single cohesive core service**, consumed
**server-side only**. No React bindings.

### Upstream API summary (verified against the live OpenAPI)

- **Auth:** OAuth2 `clientCredentials` only. Scopes:
  - `sequentialid.schema_view` — read schemas + request next ids
  - `sequentialid.schema_manage` — create / delete / set-active schemas
  This is an **admin/service token**, never to be exposed in a browser.
- **Base path:** `/sequential-id/{tenant}` (tenant from config).
- **Schema endpoints** (under `/sequential-id/{tenant}/schemas`):
  - `GET /schemas` — list all schemas (`schema_view`)
  - `POST /schemas` — create a schema; returns the created `SequenceSchema` (`schema_manage`)
  - `GET /schemas/{schemaId}` — retrieve one schema (`schema_view`)
  - `DELETE /schemas/{schemaId}` — delete a schema; **204** (`schema_manage`)
  - `POST /schemas/{schemaId}/setActive` — mark a schema active for its type (`schema_manage`)
  - `GET /schemas/types/{schemaType}` — get the active schema for a type (`schema_view`)
  - `POST /schemas/types/{schemaType}/nextId` — generate the next id; body
    `NextIdCommandRequest`; optional `?siteCode=` query (`schema_view`)
- **Batch endpoint** (NOTE: **no `{tenant}` in the path** — tenant is derived
  from the token):
  - `POST /sequential-id/sequenceSchemaBatch/nextIds` — generate next ids for
    multiple schema types in one call (`schema_view`)
- **Shapes:**
  - `SequenceSchemaCreate` (request body for create):
    - `name: string` (required)
    - `schemaType?: string`
    - `preText?: string`
    - `postText?: string`
    - `startValue: integer` (required)
    - `maxValue: integer` (required)
    - `numberOfDigits: integer` (required)
    - `placeholders?: Record<string, { required: boolean; default?: string }>`
  - `SequenceSchema` (response) = `SequenceSchemaCreate` + server-managed
    `{ id: string; active: boolean; counter: integer; metadata: { createdAt: string; modifiedAt: string; version: integer } }`
  - `NextIdCommandRequest` = `{ sequenceKey?: string; placeholders?: Record<string, string> }`
  - `NextIdResponse` = `{ id: string }`
  - Batch request: `Record<schemaType, { numberOfIds: integer; sequenceKey?: string; placeholders?: Record<string, string> }>`
  - Batch response: `Record<schemaType, { ids: string[] }>`

## 2. Decisions (resolved during brainstorming)

| # | Decision | Choice |
|---|---|---|
| D1 | Scope | **Schema CRUD + set-active + next-id (single & batch)** — bind everything the API exposes (small, cohesive); no PATCH/PUT because the API has none (schemas are immutable: delete + recreate) |
| D2 | React bindings | **None** — core SDK only, server-side consumption |
| D3 | API shape | **One service** `client.sequentialIds` (analogous to `media` / `availability`) — the endpoints form one cohesive admin/generation surface |
| D4 | Method name for DELETE | `deleteSchema` (explicit — the surface has several POST/GET verbs; a bare `delete` would be ambiguous next to `setActiveSchema`/`createSchema`) |
| D5 | Types source | **Codegen** via the existing `@hey-api/openapi-ts` pipeline + thin public aliases in `sequential-id-types.ts` |
| D6 | Default auth | `{ kind: "service" }` (credential set `"backend"`), overridable per call — identical to `price.ts` / `media.ts` / `tenant-config.ts` |
| D7 | Batch path | Built **without** the `{tenant}` segment (`/sequential-id/sequenceSchemaBatch/nextIds`) — the API derives the tenant from the token. Documented as a quirk. |
| D8 | `siteCode` on `nextId` | Optional `opts` arg `{ siteCode?: string }`; serialized to `?siteCode=` only when present. Drives time/country placeholders from site settings server-side. |

## 3. Public API surface

```ts
// types (src/services/sequential-id-types.ts) — thin aliases over generated
export type SequenceSchema = GenSequenceSchema;             // response (id, active, counter, metadata)
export type SequenceSchemaCreate = GenSequenceSchemaCreate; // create body
export type NextIdCommandRequest = GenNextIdCommandRequest; // { sequenceKey?, placeholders? }
export type NextIdResponse = GenNextIdResponse;             // { id }

/** Per-call options for {@link SequentialIdService.nextId}. */
export interface NextIdOptions {
  /** Derives time/country placeholders from the site's settings. */
  siteCode?: string;
}

/** One entry in a batch next-ids request, keyed by schema type. */
export interface BatchNextIdEntry {
  numberOfIds: number;
  sequenceKey?: string;
  placeholders?: Record<string, string>;
}
export type NextIdsBatchRequest = Record<string, BatchNextIdEntry>;
export type NextIdsBatchResponse = Record<string, { ids: string[] }>;
```

```ts
// client.sequentialIds — SequentialIdService
listSchemas(auth?: AuthContext): Promise<SequenceSchema[]>
getSchema(schemaId: string, auth?: AuthContext): Promise<SequenceSchema>
createSchema(schema: SequenceSchemaCreate, auth?: AuthContext): Promise<SequenceSchema>
deleteSchema(schemaId: string, auth?: AuthContext): Promise<void>
setActiveSchema(schemaId: string, auth?: AuthContext): Promise<void>
listSchemasByType(schemaType: string, auth?: AuthContext): Promise<SequenceSchema>
nextId(schemaType: string, body?: NextIdCommandRequest, opts?: NextIdOptions, auth?: AuthContext): Promise<NextIdResponse>
nextIdsBatch(req: NextIdsBatchRequest, auth?: AuthContext): Promise<NextIdsBatchResponse>
```

### Behavioral notes
- `nextId` body is optional (defaults to `{}`); `opts.siteCode` is serialized to
  `query: { siteCode }` only when present, omitted otherwise.
- `nextIdsBatch` posts the map verbatim; the path **omits** `{tenant}`.
- `schemaId`, `schemaType` are `encodeURIComponent`-escaped in paths.
- `setActiveSchema` returns `void` (the POST has no meaningful body to surface).
- `listSchemasByType` returns a single `SequenceSchema` (the active one for the
  type) — named `listSchemasByType` per the brief; documented as "the active
  schema for this type".

## 4. Auth & data flow

- Module-level default: `const SERVICE: AuthContext = { kind: "service" }`
  (resolves to the `"backend"` credential set via `DefaultTokenProvider.getToken`).
  Every method takes a trailing optional `auth` defaulting to `SERVICE`.
- All requests go through `this.ctx.http.request<T>({ method, path, query, body, auth })`.
- Paths:
  - tenant-scoped: `/sequential-id/${tenant}/schemas`, `…/schemas/${enc(id)}`,
    `…/schemas/${enc(id)}/setActive`, `…/schemas/types/${enc(type)}`,
    `…/schemas/types/${enc(type)}/nextId`
  - batch (no tenant): `/sequential-id/sequenceSchemaBatch/nextIds`
- Server-only contract is documented; no anonymous/customer default, no React surface.

## 5. Codegen integration

1. `packages/sdk/scripts/fetch-specs.ts` — add to `SPECS`:
   ```ts
   "sequential-id": `${BASE}/utilities/sequential-id/api-reference/api.yml`,
   ```
   (URL verified live → HTTP 200.)
2. `pnpm -F @viu/emporix-sdk fetch:specs && pnpm -F @viu/emporix-sdk generate`
   → produces `src/generated/sequential-id/{index.ts,types.gen.ts}` (types only).
3. Public aliases in `src/services/sequential-id-types.ts` import the generated
   base types. If hey-api emits different names than
   `SequenceSchema`/`SequenceSchemaCreate`/`NextIdCommandRequest`/`NextIdResponse`,
   alias accordingly (the thin layer absorbs that). The batch request/response
   are hand-typed `Record<…>` maps — open dictionary shapes the generator tends
   to emit as loose `{ [key: string]: unknown }`, so the SDK pins them explicitly.

## 6. Wiring

- `src/core/logger.ts`: add `"sequential-id"` to the `ServiceName` union.
- `src/client.ts`:
  - import `SequentialIdService`
  - add `readonly sequentialIds: SequentialIdService`
  - construct with `mk("sequential-id")`
- `src/index.ts`: re-export the facade.
- `src/sequential-id.ts`: one-line `export * from "./services/sequential-id"`.

## 7. Error handling

Reuse the existing HTTP error mapping in `core/http` + `core/errors`:
- 404 → `EmporixNotFoundError` (propagates from `getSchema`/`deleteSchema`/`setActiveSchema`/`listSchemasByType`/`nextId`)
- 409 → existing conflict error (e.g. duplicate active schema per type)
- 400 → existing validation error (missing required placeholders, bad range)
No service-specific catch logic.

## 8. Testing (Vitest + MSW)

`tests/services/sequential-id.test.ts` (MSW harness: `oauth/token` → `svc-tok`,
assert `Authorization: Bearer svc-tok`):
- `listSchemas` happy path
- `getSchema` happy path; `getSchema` → 404 throws `EmporixNotFoundError`
- `createSchema` echoes the posted body and returns the created `SequenceSchema`
- `deleteSchema` → 204 resolves to `void`
- `setActiveSchema` POSTs `…/setActive` and resolves to `void`
- `listSchemasByType` GETs `…/schemas/types/{type}` and returns the active schema
- `nextId` POSTs `…/types/{type}/nextId` with the body; **no `siteCode`** query when omitted
- `nextId` serializes `?siteCode=` when `opts.siteCode` is provided
- `nextIdsBatch` POSTs to `/sequential-id/sequenceSchemaBatch/nextIds`
  (assert the path has **no tenant** segment) and returns the id map
- `encodeURIComponent`-escapes `schemaType` in the path
- Type-level test (`tests/services/sequential-id-types.test.ts`): the public
  aliases expose the expected required fields.
- Wiring test (`tests/services/sequential-id-wiring.test.ts`):
  `client.sequentialIds instanceof SequentialIdService`.

## 9. Out of scope (YAGNI)

- React hooks / `@viu/emporix-sdk-react` surface
- e2e (admin token must not live in the vite-spa)
- Client-side validation of placeholders / range (server enforces)
- A schema "update" helper (the API has no PATCH/PUT — schemas are immutable;
  callers `deleteSchema` + `createSchema`)
- Caching, counter-reset helpers (the `maxValue` cap is a hard stop by design)

## 10. File-by-file change list

| File | Change |
|---|---|
| `packages/sdk/scripts/fetch-specs.ts` | add `"sequential-id"` spec entry |
| `packages/sdk/specs/sequential-id.yml` | fetched OpenAPI (committed) |
| `packages/sdk/src/generated/sequential-id/**` | generated (committed) |
| `packages/sdk/src/services/sequential-id-types.ts` | new — public types |
| `packages/sdk/src/services/sequential-id.ts` | new — `SequentialIdService` |
| `packages/sdk/src/sequential-id.ts` | new — re-export facade |
| `packages/sdk/src/core/logger.ts` | add `"sequential-id"` to `ServiceName` |
| `packages/sdk/src/client.ts` | wire `sequentialIds` |
| `packages/sdk/src/index.ts` | re-export the facade |
| `packages/sdk/tests/services/sequential-id-types.test.ts` | new type-level tests |
| `packages/sdk/tests/services/sequential-id.test.ts` | new MSW tests |
| `packages/sdk/tests/services/sequential-id-wiring.test.ts` | new wiring test |
| `docs/sequential-id.md` | new — usage doc |
| `CLAUDE.md` | add SequentialId to the service list |
| `.changeset/*.md` | minor: new service `sequentialIds` |
