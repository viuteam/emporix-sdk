# Schema Service Binding — Design

- **Date:** 2026-06-01
- **Status:** Approved (design); pending implementation plan
- **Package:** `@viu/emporix-sdk` (core only)
- **Branch:** `feat/schema-service`

## 1. Context & motivation

The SDK exposes a service binding per Emporix Commerce Engine service. The
**Schema Service** (`/schema/{tenant}/…`) is not yet bound. It defines and
manages **schemas** (typed attribute definitions attached to native entities
such as `PRODUCT`, `CART`, `ORDER`), **custom entities** (tenant-defined
resource definitions), and **custom instances** (the actual data records of a
custom entity). It is the backbone of Emporix's "mixins" / custom-data model.

This design adds bindings for four resource groups as **one core service**,
consumed **server-side only**. No React bindings. It follows the established
"configuration service" pattern exactly (codegen → public types → service →
facade → wiring → tests → docs → changeset).

### Upstream API summary (verified against the live OpenAPI + docs)

- **Base path:** `/schema/{tenant}`.
- **Auth:** OAuth2 `clientCredentials`. Scopes:
  - `schema.schema_read` / `schema.schema_manage` — schemas + types
  - `schema.custominstance_read` / `schema.custominstance_manage` — custom
    entities + instances (plus per-type `custom.{type}_read|manage[_own]`)
  - GET endpoints need a token but no explicit scope.
  This is an **admin/service token**, never to be exposed in a browser.
- **(A) Schemas** — `/schema/{tenant}/schemas`
  - `GET /schemas` — list; filters `q` (supports `compoundLogicalQuery`),
    `type`; paginated (`pageNumber`/`pageSize`).
  - `POST /schemas` — create.
  - `GET /schemas/{id}` — retrieve one.
  - `PUT /schemas/{id}` — update; **requires `metadata.version`** (409 on
    mismatch).
  - `DELETE /schemas/{id}` — delete.
  - `POST /schemas/file` — validate a schema document **without persisting**.
- **(B) Types** — `/schema/{tenant}/types` & `/schema/{tenant}/schemas/{id}/types`
  - `GET /types` — list types that currently have at least one schema
    (returns only populated types).
  - `PUT /schemas/{id}/types` — set the entity types a schema applies to.
- **(C) Custom entities** — `/schema/{tenant}/custom-entities`
  - `GET /custom-entities` — list (`?expandSchemas` to inline schema bodies).
  - `POST /custom-entities` — create.
  - `GET /custom-entities/{id}` — retrieve one.
  - `PUT /custom-entities/{id}` — update.
  - `DELETE /custom-entities/{id}` — delete (fails if instances/schemas exist).
- **(D) Custom instances** — `/schema/{tenant}/custom-entities/{type}/instances`
  - `GET /…/instances` — list (paginated).
  - `POST /…/instances` — create.
  - `GET /…/instances/{id}` — retrieve one.
  - `PUT /…/instances/{id}` — replace.
  - `PATCH /…/instances/{id}` — partial update.
  - `DELETE /…/instances/{id}` — delete.
  - `POST /…/instances/search` — structured search (request body filter).

### Wire shapes (from the spec)

- `SchemaResponse`:
  - `id: string`
  - `name: { [locale]: string }` (localized map)
  - `types: SchemaType[]`
  - `attributes: SchemaAttribute[]`
  - `metadata: { version: number; url?: string; createdAt?: string; modifiedAt?: string }`
    (`version` is required on `PUT`; `url` points to the Cloudinary-hosted doc)
- `SchemaAttribute`:
  - `key: string`
  - `name: { [locale]: string }`
  - `description?: { [locale]: string }`
  - `type: "TEXT" | "NUMBER" | "DECIMAL" | "BOOLEAN" | "DATE" | "TIME" | "DATE_TIME" | "ENUM" | "ARRAY" | "OBJECT" | "REFERENCE"`
    (`REFERENCE` only valid for custom entities)
  - `metadata?: { readOnly?: boolean; localized?: boolean; required?: boolean; nullable?: boolean }`
  - `values?: unknown[]` (for `ENUM`)
  - `attributes?: SchemaAttribute[]` (recursion for `OBJECT`)
  - `arrayType?: string` (element type for `ARRAY`)
- `SchemaType` enum: `CART, CART_ITEM, CATEGORY, COMPANY, COUPON, CUSTOMER,
  CUSTOMER_ADDRESS, ORDER, ORDER_ENTRY, PRODUCT, QUOTE, RETURN, PRICE_LIST,
  SITE, CUSTOM_ENTITY, VENDOR`.
- `CustomEntityResponse` ≈ `SchemaResponse` (entity definition + its attributes).
- `CustomInstanceResponse`:
  - `id: string`
  - `name: { [locale]: string }`
  - `type: string` (the custom-entity type)
  - `owner: { type: string; userId: string; legalEntityId?: string }`
  - `mixins: object` (the actual data, keyed by mixin/schema)
  - `metadata: { version: number; createdAt?: string; modifiedAt?: string }`

## 2. Decisions (resolved during brainstorming)

| # | Decision | Choice |
|---|---|---|
| D1 | Scope | Bind groups **A** (schemas CRUD + validate-file), **B** (types), **C** (custom-entities CRUD), **D** (custom-instances CRUD + search). Defer E/F/bulk (see §9). |
| D2 | React bindings | **None** — core SDK only, server-side consumption. |
| D3 | API shape | **One service** `client.schemas` (a single `SchemaService`) covering all four groups. The groups share auth, base path, and codegen module — splitting them adds surface without value (YAGNI). |
| D4 | Method name for DELETE | `delete*` (mirrors the HTTP verb; precedent: `tenantConfig.delete`, `locations.delete`). |
| D5 | Instance value typing | Generic `<T = Record<string, unknown>>` overlaid on `CustomInstanceResponse.mixins` so callers can pin their mixin shape (mirrors `Configuration<T>` overlaying `value`). |
| D6 | Types source | Codegen via the existing `@hey-api/openapi-ts` pipeline + thin public aliases (identical to configuration). |
| D7 | Default auth | `{ kind: "service" }` (credential set `"backend"`), overridable per call — identical to `media.ts` / `tenant-config.ts`. |
| D8 | Pagination | List endpoints (schemas, instances, search) return the shared `PaginatedItems<T>` envelope with `pageNumber`/`pageSize` defaults, exactly like `media.list`. `listCustomEntities` and `listTypes` are not server-paginated → return plain arrays. |
| D9 | `validateSchemaFile` | Distinct method (not part of CRUD); posts a schema document to `/schemas/file` and returns the validation result without persisting. |
| D10 | Custom-instance `type` arg | Always the **first** argument (mirrors `clientConfig`'s `client`-first convention), since every instance path is parameterized by `{type}`. |

## 3. Public API surface

```ts
// types (src/services/schema-types.ts) — thin overlays on the generated module
export type Schema = GenSchemaResponse;
export type SchemaAttribute = GenSchemaAttribute;
export type SchemaTypeName = GenSchemaType; // string-literal union
export type CustomEntity = GenCustomEntityResponse;
export type CustomInstance<T = Record<string, unknown>> =
  Omit<GenCustomInstanceResponse, "mixins"> & { mixins: T };

// drafts — server-managed fields removed
export type SchemaDraft = …;        // no metadata.version on create
export type SchemaUpdate = …;       // requires metadata.version
export type CustomEntityDraft = …;
export type CustomInstanceDraft<T = Record<string, unknown>> = …;

// query / search options
export interface ListSchemasQuery { q?: string; type?: SchemaTypeName; pageNumber?: number; pageSize?: number }
export interface ListInstancesQuery { pageNumber?: number; pageSize?: number; [k: string]: string | number | undefined }
export interface ListCustomEntitiesOptions { expandSchemas?: boolean }
export type InstanceSearchBody = Record<string, unknown>; // structured search filter
```

```ts
// client.schemas — SchemaService

// (A) Schemas
listSchemas(query?: ListSchemasQuery, auth?): Promise<PaginatedItems<Schema>>
getSchema(id: string, auth?): Promise<Schema>
createSchema(draft: SchemaDraft, auth?): Promise<Schema>
updateSchema(id: string, draft: SchemaUpdate, auth?): Promise<Schema>  // draft.metadata.version required
deleteSchema(id: string, auth?): Promise<void>
validateSchemaFile(body: SchemaDraft, auth?): Promise<SchemaValidationResult>

// (B) Types
listTypes(auth?): Promise<SchemaTypeName[]>
setSchemaTypes(id: string, types: SchemaTypeName[], auth?): Promise<Schema>

// (C) Custom entities
listCustomEntities(opts?: ListCustomEntitiesOptions, auth?): Promise<CustomEntity[]>
getCustomEntity(id: string, auth?): Promise<CustomEntity>
createCustomEntity(draft: CustomEntityDraft, auth?): Promise<CustomEntity>
updateCustomEntity(id: string, draft: CustomEntityDraft, auth?): Promise<CustomEntity>
deleteCustomEntity(id: string, auth?): Promise<void>

// (D) Custom instances — `type` is always the first arg
listInstances<T = Record<string, unknown>>(type: string, query?: ListInstancesQuery, auth?): Promise<PaginatedItems<CustomInstance<T>>>
getInstance<T = Record<string, unknown>>(type: string, id: string, auth?): Promise<CustomInstance<T>>
createInstance<T = Record<string, unknown>>(type: string, draft: CustomInstanceDraft<T>, auth?): Promise<CustomInstance<T>>
replaceInstance<T = Record<string, unknown>>(type: string, id: string, draft: CustomInstanceDraft<T>, auth?): Promise<CustomInstance<T>>
patchInstance<T = Record<string, unknown>>(type: string, id: string, patch: Partial<CustomInstanceDraft<T>>, auth?): Promise<CustomInstance<T>>
deleteInstance(type: string, id: string, auth?): Promise<void>
searchInstances<T = Record<string, unknown>>(type: string, body: InstanceSearchBody, auth?): Promise<PaginatedItems<CustomInstance<T>>>
```

### Behavioral notes

- `listSchemas` query is built explicitly (`q`, `type`, `pageNumber`,
  `pageSize`); empty/undefined fields are omitted.
- `id`, `type`, and `key` path segments are `encodeURIComponent`-escaped.
- `updateSchema` requires `draft.metadata.version`; on a stale version the
  server returns **409** which propagates as the existing conflict error. The
  SDK does not auto-fetch/retry (no optimistic-locking helper — YAGNI).
- `patchInstance` sends `PATCH` with a partial body; `replaceInstance` sends a
  full `PUT`.
- `searchInstances` POSTs to `/instances/search`; the response is wrapped in
  `PaginatedItems` using the same "page full" heuristic as `listInstances`.
- `listCustomEntities` and `listTypes` return plain arrays (not paginated by
  the server).

## 4. Auth & data flow

- Module-level default: `const SERVICE: AuthContext = { kind: "service" }`
  (resolves to the `"backend"` credential set via `DefaultTokenProvider`).
  Every method takes a trailing optional `auth` defaulting to `SERVICE`.
- All requests go through `this.ctx.http.request<T>({ method, path, query, body, auth })`.
- Paths:
  - schemas: `/schema/${tenant}/schemas` and `…/schemas/${enc(id)}`,
    `…/schemas/file`, `…/schemas/${enc(id)}/types`
  - types: `/schema/${tenant}/types`
  - custom entities: `/schema/${tenant}/custom-entities` and `…/${enc(id)}`
  - custom instances: `/schema/${tenant}/custom-entities/${enc(type)}/instances`
    and `…/instances/${enc(id)}`, `…/instances/search`
- Server-only contract is documented; no anonymous/customer default, no React
  surface.

## 5. Codegen integration

1. `packages/sdk/scripts/fetch-specs.ts` — add to `SPECS`:
   ```ts
   schema: `${BASE}/utilities/schema/api-reference/api.yml`,
   ```
   (URL verified live → HTTP 200.)
2. `pnpm -F @viu/emporix-sdk fetch:specs && pnpm -F @viu/emporix-sdk generate`
   → produces `src/generated/schema/{index.ts,types.gen.ts}` (types only).
3. Public aliases in `src/services/schema-types.ts` import the generated base
   types and overlay the `<T>` generic on `CustomInstance.mixins`. If hey-api
   emits different names (e.g. `SchemaResponse` vs `Schema`), alias accordingly
   — the thin layer absorbs the difference.

## 6. Wiring

- `src/core/logger.ts`: add `"schema"` to the `ServiceName` union (before
  `"http"`).
- `src/client.ts`:
  - import `SchemaService`
  - add `readonly schemas: SchemaService`
  - construct with `mk("schema")`
- `src/index.ts`: re-export the public types and the service class via the
  facade (`export * from "./schema"`).
- `src/schema.ts`: one-line `export * from "./services/schema"`.

## 7. Error handling

Reuse the existing HTTP error mapping in `core/http` + `core/errors`:
- 404 → `EmporixNotFoundError` (propagates from `get*`/`update*`/`delete*`)
- 409 → existing conflict error (`updateSchema` version mismatch;
  `deleteCustomEntity` when instances/schemas exist)
- 400 → existing validation error (`createSchema`, `validateSchemaFile`)
No service-specific catch logic.

## 8. Testing (Vitest + MSW)

`tests/services/schema-types.test.ts` (type-level) and
`tests/services/schema.test.ts` (MSW), wiring in
`tests/services/schema-wiring.test.ts`:
- MSW oauth handler returns `svc-tok`; every method asserts the request carries
  `authorization: "Bearer svc-tok"`.
- `listSchemas` with and without `q`/`type` filters (assert query params),
  paginated envelope shape.
- `getSchema` happy path; `getSchema` → 404 throws `EmporixNotFoundError`.
- `createSchema` echoes the posted body; `updateSchema` requires + round-trips
  `metadata.version`; `deleteSchema` → 204 resolves to `void`.
- `validateSchemaFile` POSTs to `/schemas/file` and returns the result.
- `listTypes` returns the array; `setSchemaTypes` PUTs the `types` body.
- custom-entity CRUD (`list`/`get`/`create`/`update`/`delete`), incl.
  `expandSchemas` query.
- custom-instance CRUD (`list`/`get`/`create`/`replace`/`patch`/`delete`),
  `type`-first arg, `PATCH` partial body, `searchInstances` POST.
- `encodeURIComponent`-escapes `id`/`type` in paths.
- Type-level: `getInstance<MyMixins>(…)` yields `CustomInstance<MyMixins>`.

## 9. Out of scope (YAGNI / DEFER)

- **Group E — References (multipart):** the schema-reference upload/download
  endpoints (multipart bodies) are deferred; a follow-up can mirror `media`'s
  multipart `create`.
- **Group F — Export / Import:** the bulk schema export/import endpoints are
  deferred. (Note: import creates a `_COPY` on name conflict.)
- **Bulk instance operations:** `POST/PUT/DELETE /custom-entities/{type}/instances/bulk`
  are deferred.
- React hooks / `@viu/emporix-sdk-react` surface.
- e2e (admin token must not live in the vite-spa).
- Client-side schema/JSON-Schema validation (server enforces it).
- Caching / optimistic-locking helpers around `metadata.version`.

## 10. File-by-file change list

| File | Change |
|---|---|
| `packages/sdk/scripts/fetch-specs.ts` | add `schema` spec entry |
| `packages/sdk/specs/schema.yml` | fetched OpenAPI (committed artifact) |
| `packages/sdk/src/generated/schema/**` | generated (committed) |
| `packages/sdk/src/services/schema-types.ts` | new — public types |
| `packages/sdk/src/services/schema.ts` | new — `SchemaService` |
| `packages/sdk/src/schema.ts` | new — re-export facade |
| `packages/sdk/src/core/logger.ts` | add `"schema"` to `ServiceName` |
| `packages/sdk/src/client.ts` | wire `schemas` service |
| `packages/sdk/src/index.ts` | re-export types + class |
| `packages/sdk/tests/services/schema-types.test.ts` | new type-level tests |
| `packages/sdk/tests/services/schema.test.ts` | new MSW tests |
| `packages/sdk/tests/services/schema-wiring.test.ts` | client wiring test |
| `docs/schema.md` | new — usage doc |
| `CLAUDE.md` | add Schema to the service list |
| `.changeset/*.md` | minor: new `schemas` service |
