# Schema Admin CRUD — Design

**Date:** 2026-07-25
**Package:** `@viu/emporix-sdk`
**Service:** `SchemaService` (`client.schema`)
**Spec source:** `packages/sdk/specs/schema.yml` → generated `src/generated/schema/types.gen.ts`

## Goal

`SchemaService` already covers schemas, entity types, custom entities and the
single-instance CRUD (21 of 31 operations). Three groups are missing: the
**reference** entity CRUD, the **instance bulk** create/upsert/delete (only
bulk-PATCH is wrapped), and the custom-entity **export/import** pair. This work
adds those 10 operations, completing coverage of `schema.yml`.

## Scope

Extend the existing `SchemaService` with a `references` sub-resource plus flat
methods for the bulk and export/import operations. No new class, no client
wiring change, no constructor change.

**Verified against the generated types:** 31 operations, **none deprecated**,
21 wrapped → **10 to implement**.

### Already covered (unchanged)

Schemas (`listSchemas`, `getSchema`, `createSchema`, `updateSchema`,
`deleteSchema`, `validateSchemaFile`, `listTypes`, `setSchemaTypes`), custom
entities (`listCustomEntities`, `getCustomEntity`, `createCustomEntity`,
`updateCustomEntity`, `deleteCustomEntity`) and instances (`listInstances`,
`getInstance`, `createInstance`, `replaceInstance`, `patchInstance`,
`bulkPatchInstances`, `deleteInstance`, `searchInstances`).

## Auth model

This service is backend-only and already defaults every method to
`const SERVICE: AuthContext = { kind: "service" }` (declared at line 38). All new
methods follow that pattern with a trailing `auth: AuthContext = SERVICE`.

## API surface

### 1 — `schema.references` sub-resource (5)

A `readonly references = { … }` object literal of arrow functions.

| Method | HTTP | Returns |
|---|---|---|
| `list(params?, auth?)` | GET `/references` | `PaginatedItems<SchemaReference>` |
| `get(id, auth?)` | GET `/references/{id}` | `SchemaReference` (200) |
| `create(input, auth?)` | POST `/references` (**multipart**) | `SchemaReferenceCreated` (201) |
| `update(id, input, options?, auth?)` | PUT `/references/{id}` (**multipart**) | `void` (204) |
| `delete(id, auth?)` | DELETE `/references/{id}` | `void` (204) |

- `list` `params`: `pageNumber?`, `pageSize?`, `sort?`, `q?`, `fields?`,
  `type?`. The endpoint returns a bare array, wrapped into `PaginatedItems` the
  way `listSchemas` already does in this service.
- `update` `options`: `{ version?: number }` → the `version` query parameter
  (optimistic locking), sent only when given.

#### Multipart upload

`POST`/`PUT /references` are `multipart/form-data` with two parts: `file` (the
reference's JSON content) and `body` (the metadata). This mirrors
`MediaService.create`, and `HttpClient` already handles `FormData` bodies
natively (it detects `body instanceof FormData` and lets `fetch` set the
boundary).

The input shape is:

```ts
{ file: Blob | Record<string, unknown>; body: SchemaReferenceInput }
```

A `Blob` is forwarded as-is; a plain object is serialized into a JSON blob
(`new Blob([JSON.stringify(file)], { type: "application/json" })`) — the common
case, since the spec types the file as `format: json`. Both parts are set with
`fd.set("file", …)` / `fd.set("body", JSON.stringify(body))`, matching the media
service.

### 2 — Instance bulk operations (3)

| Method | HTTP | Returns |
|---|---|---|
| `bulkCreateInstances(type, items, auth?)` | POST `…/instances/bulk` | `BulkInstanceResult` (207) |
| `bulkUpsertInstances(type, items, auth?)` | PUT `…/instances/bulk` | `BulkInstanceResult` (207) |
| `bulkDeleteInstances(type, ids, auth?)` | DELETE `…/instances/bulk` | `BulkInstanceResult` (207) |

These complete the bulk group alongside the existing `bulkPatchInstances`
(PATCH). All respond 207 Multi-Status: partial failures do **not** throw —
inspect each entry. Paths reuse the existing private `instancesBase(type)`
helper, which already `encodeURIComponent`-escapes the type.

- `bulkCreateInstances` items: `SchemaInstanceBulkCreateItem[]`
  (`CustomInstanceCreation`).
- `bulkUpsertInstances` items: `SchemaInstanceBulkUpsertItem[]`
  (`{ id: string } & CustomInstanceUpdate`).

#### Deliberate deviation: the bulk-delete body

The `DELETE …/instances/bulk` operation's description states the ids must be
passed **"in the request body as an array of strings"** and gives the example
`["firstId", "secondId", "thirdId"]` — but the spec declares no `requestBody`,
so the generated type says `body?: never`.

This design follows the documented behavior and sends `string[]` as the body. An
id-less bulk delete would either be meaningless or, worse, delete every instance
of the type. The deviation is recorded here, in the method docstring, and in the
changeset; it is **not verified against the live API**.

### 3 — Custom-entity export / import (2)

| Method | HTTP | Returns |
|---|---|---|
| `exportCustomEntities(types, auth?)` | POST `/custom-entities/export` (body `string[]`) | `SchemaExport` (200) |
| `importCustomEntities(input, auth?)` | POST `/custom-entities/import` | `void` (204) |

`SchemaExport` carries `data` (a base64 representation of the custom entities
plus their schemas) and `exportedAt`. `importCustomEntities` takes the matching
`{ data }` back.

### 4 — Public types (alias → generated)

Declared in `packages/sdk/src/services/schema-types.ts` (where the service's
other aliases live) and re-exported from `services/schema.ts`. The root barrel
`src/schema.ts` uses `export *` and `index.ts` re-exports that barrel, so **no
`index.ts` change is needed**.

| Public alias | Generated type |
|---|---|
| `SchemaReference` | `ReferenceResponse` |
| `SchemaReferenceInput` | `ReferenceCreation` |
| `SchemaReferenceUpdateInput` | `ReferenceUpdate` |
| `SchemaReferenceCreated` | `IdResponse` |
| `SchemaInstanceBulkCreateItem` | `CustomInstanceCreation` |
| `SchemaInstanceBulkUpsertItem` | `{ id: string } & CustomInstanceUpdate` |
| `SchemaExport` | `ExportImportResponse` |
| `SchemaImportInput` | `ExportImportRequest` |

The existing `BulkInstanceResult` (= generated `BulkResponse`) is reused for all
three new bulk methods.

## Error handling

No new error handling — the shared `HttpClient` maps status codes to the
`Emporix*Error` hierarchy (409 on a stale `version` for reference updates). The
207 bulk responses are returned as-is, not thrown.

## Testing

New unit test `packages/sdk/tests/services/schema-admin.test.ts` using the
`vi.fn()`-mocked `http.request` harness (`ctxWith`), mirroring
`site-admin.test.ts`.

- **References block:** `list` wraps into `PaginatedItems` and forwards the
  filter params; `get`/`delete` hit their paths; `create`/`update` send a
  `FormData` body whose `file` and `body` parts are asserted (including that a
  plain object is serialized to a JSON blob); `update` sends the `version` query
  only when given.
- **Bulk block:** `bulkCreateInstances` POSTs, `bulkUpsertInstances` PUTs, and
  `bulkDeleteInstances` DELETEs `…/instances/bulk`, the last one carrying the
  `string[]` id body.
- **Export/import block:** `exportCustomEntities` POSTs the type array to
  `/custom-entities/export`; `importCustomEntities` POSTs `{ data }` to
  `/custom-entities/import`.

## Release

Changeset `.changeset/schema-admin-crud.md`, `@viu/emporix-sdk` **minor**
(additive: new methods + types, no change to existing behavior).

## Out of scope

- React hooks — this service is explicitly server-side only (its docstring warns
  the service token must never reach a browser).
- Live tenant verification, including of the bulk-delete body deviation.
