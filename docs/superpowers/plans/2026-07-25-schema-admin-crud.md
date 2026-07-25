# Schema Admin CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the 10 missing schema-service operations to `SchemaService` — the `references` CRUD (multipart uploads), the instance bulk create/upsert/delete, and the custom-entity export/import — completing coverage of `packages/sdk/specs/schema.yml`.

**Architecture:** A `readonly references = {…}` sub-resource plus five flat methods on the existing class. Every method keeps the service's existing `auth: AuthContext = SERVICE` default. New types are aliases in `schema-types.ts`, re-exported from `services/schema.ts`; the root barrel uses `export *`, so `index.ts` needs no edit.

**Tech Stack:** TypeScript, Vitest (`vi.fn()`-mocked `http.request`), `@hey-api/openapi-ts`-generated types under `src/generated/schema`.

## Global Constraints

- Package: `@viu/emporix-sdk`. Release bump: **minor** (additive).
- HTTP: `this.ctx.http.request<T>({ method, path, query?, body?, auth })`. Reuse the private helpers `this.entitiesBase()` and `this.instancesBase(type)` (the latter already `encodeURIComponent`-escapes `type`). References need a new private `referencesBase()`.
- `const SERVICE: AuthContext = { kind: "service" }` already exists at line 38. Every new method ends with `auth: AuthContext = SERVICE`. The parameter is named `auth` in this file (no helper-module clash here — unlike payment/site).
- Ids in paths are `encodeURIComponent`-escaped, matching `getSchema` / `deleteInstance`.
- Paginated list default in this service is **`pageSize: 60`** (not 50) — match `listSchemas`.
- **Multipart:** build a `FormData` and pass it as `body`; `HttpClient` detects `body instanceof FormData` and lets `fetch` set the boundary. Follow `MediaService.create`: `fd.set("file", blob)` + `fd.set("body", JSON.stringify(bodyObj))`.
- **`bulkDeleteInstances` sends a `string[]` body** even though the generated type says `body?: never` — the spec's description mandates it (see the design doc).
- Commitlint: `schema` is NOT in the scope allowlist — use scope **`sdk`**. Subject's first word must be a lowercase verb.
- Do NOT modify existing methods.

## File Structure

- **Modify** `packages/sdk/src/services/schema-types.ts` — add 8 type aliases.
- **Modify** `packages/sdk/src/services/schema.ts` — extend the type import + re-export block, add a private `referencesBase()`, add the `references` sub-resource and 5 flat methods (the class's closing `}` is at line 363).
- **Create** `packages/sdk/tests/services/schema-admin.test.ts`.
- **Create** `.changeset/schema-admin-crud.md`.
- **No** `index.ts` change (`src/schema.ts` is `export * from "./services/schema"`, re-exported by `index.ts:245`).

---

### Task 1: Types + `schema.references` sub-resource

**Files:**
- Modify: `packages/sdk/src/services/schema-types.ts`
- Modify: `packages/sdk/src/services/schema.ts` (import block lines 3-36; `referencesBase()` after `instancesBase()` which ends line 60; `references` member appended before the class's closing `}` on line 363)
- Test: `packages/sdk/tests/services/schema-admin.test.ts` (create)

**Interfaces:**
- Consumes: existing `SchemaService(ctx)`, `SERVICE`, `PaginatedItems`.
- Produces (all 8 aliases, so Tasks 2/3 need no type work):
  - `type SchemaReference`, `SchemaReferenceInput`, `SchemaReferenceUpdateInput`, `SchemaReferenceCreated`, `SchemaInstanceBulkCreateItem`, `SchemaInstanceBulkUpsertItem`, `SchemaExport`, `SchemaImportInput`
  - `interface ListSchemaReferencesQuery`
  - `readonly references` with `list`, `get`, `create`, `update`, `delete` (signatures in Step 5)

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/schema-admin.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { SchemaService } from "../../src/services/schema";

function ctxWith(request: ReturnType<typeof vi.fn>): ConstructorParameters<typeof SchemaService>[0] {
  return {
    tenant: "acme",
    http: { request },
    tokenProvider: { getToken: vi.fn() },
    logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}
const svc = (req: ReturnType<typeof vi.fn>): SchemaService => new SchemaService(ctxWith(req));
const R = "/schema/acme/references";
const E = "/schema/acme/custom-entities";

describe("SchemaService.references", () => {
  it("list wraps into PaginatedItems and forwards filters", async () => {
    const l = vi.fn().mockResolvedValue([{ id: "r1" }]);
    const res = await svc(l).references.list({ pageSize: 10, type: "PRODUCT", q: "name:x" });
    expect(l).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: R,
        auth: { kind: "service" },
        query: expect.objectContaining({ pageNumber: 1, pageSize: 10, type: "PRODUCT", q: "name:x" }),
      }),
    );
    expect(res).toEqual({ items: [{ id: "r1" }], pageNumber: 1, pageSize: 10, hasNextPage: false });
  });

  it("get and delete hit /references/{id}", async () => {
    const g = vi.fn().mockResolvedValue({ id: "r1" });
    await svc(g).references.get("r1");
    expect(g).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: `${R}/r1`, auth: { kind: "service" } }),
    );

    const d = vi.fn().mockResolvedValue(undefined);
    await svc(d).references.delete("r1");
    expect(d).toHaveBeenCalledWith(
      expect.objectContaining({ method: "DELETE", path: `${R}/r1`, auth: { kind: "service" } }),
    );
  });

  it("create posts multipart with file and body parts", async () => {
    const c = vi.fn().mockResolvedValue({ id: "r1" });
    await svc(c).references.create({
      file: { some: "schema" },
      body: { name: { en: "Ref" } } as never,
    });
    const call = c.mock.calls[0]?.[0];
    expect(call).toEqual(expect.objectContaining({ method: "POST", path: R, auth: { kind: "service" } }));
    const fd = call.body as FormData;
    expect(fd).toBeInstanceOf(FormData);
    expect(fd.get("body")).toBe(JSON.stringify({ name: { en: "Ref" } }));
    const filePart = fd.get("file") as Blob;
    expect(filePart).toBeInstanceOf(Blob);
    expect(await filePart.text()).toBe(JSON.stringify({ some: "schema" }));
  });

  it("create forwards a Blob file unchanged", async () => {
    const c = vi.fn().mockResolvedValue({ id: "r1" });
    const blob = new Blob(["raw"], { type: "application/json" });
    await svc(c).references.create({ file: blob, body: {} as never });
    const fd = c.mock.calls[0]?.[0].body as FormData;
    expect(await (fd.get("file") as Blob).text()).toBe("raw");
  });

  it("update PUTs multipart and sends version only when given", async () => {
    const u = vi.fn().mockResolvedValue(undefined);
    await svc(u).references.update("r1", { file: {}, body: {} as never }, { version: 3 });
    expect(u).toHaveBeenCalledWith(
      expect.objectContaining({ method: "PUT", path: `${R}/r1`, query: { version: 3 } }),
    );

    const without = vi.fn().mockResolvedValue(undefined);
    await svc(without).references.update("r1", { file: {}, body: {} as never });
    expect(without.mock.calls[0]?.[0]).not.toHaveProperty("query");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk test -- schema-admin`
Expected: FAIL — `references` is undefined.

- [ ] **Step 3: Add the type aliases**

In `packages/sdk/src/services/schema-types.ts`, extend the generated import (lines 1-9) to:

```ts
import type {
  SchemaResponse,
  SchemaAttribute as GenSchemaAttribute,
  SchemaType as GenSchemaType,
  CustomSchemaTypeResponse,
  CustomInstanceResponse,
  BulkPatchCustomInstanceRequest as GenBulkPatchInstanceItem,
  BulkResponse as GenBulkResponse,
  ReferenceResponse,
  ReferenceCreation,
  ReferenceUpdate,
  IdResponse,
  CustomInstanceCreation,
  CustomInstanceUpdate,
  ExportImportRequest,
  ExportImportResponse,
} from "../generated/schema";
```

and append at the end of the file:

```ts
/** A reference entity (a schema attached to an uploaded JSON file). */
export type SchemaReference = ReferenceResponse;

/** Metadata part for creating a reference. */
export type SchemaReferenceInput = ReferenceCreation;

/** Metadata part for updating a reference. */
export type SchemaReferenceUpdateInput = ReferenceUpdate;

/** Id envelope returned when a reference is created. */
export type SchemaReferenceCreated = IdResponse;

/** One item for {@link SchemaService.bulkCreateInstances}. */
export type SchemaInstanceBulkCreateItem = CustomInstanceCreation;

/** One item for {@link SchemaService.bulkUpsertInstances} — an update plus its id. */
export type SchemaInstanceBulkUpsertItem = { id: string } & CustomInstanceUpdate;

/** Result of a custom-entity export — base64 `data` plus `exportedAt`. */
export type SchemaExport = ExportImportResponse;

/** Body for a custom-entity import — the base64 `data` produced by an export. */
export type SchemaImportInput = ExportImportRequest;

/** Filter / pagination options for `schema.references.list`. */
export interface ListSchemaReferencesQuery {
  pageNumber?: number;
  pageSize?: number;
  sort?: string;
  q?: string;
  fields?: string;
  /** Restrict to references attached to this entity type (e.g. `PRODUCT`). */
  type?: string;
}
```

- [ ] **Step 4: Extend the service's type import and re-export block**

In `packages/sdk/src/services/schema.ts`, add the new names to the `./schema-types` **import** (lines 3-18) — append inside the existing braces:

```ts
  SchemaReference,
  SchemaReferenceInput,
  SchemaReferenceUpdateInput,
  SchemaReferenceCreated,
  SchemaInstanceBulkCreateItem,
  SchemaInstanceBulkUpsertItem,
  SchemaExport,
  SchemaImportInput,
  ListSchemaReferencesQuery,
```

and the same names to the **re-export** block (lines 20-36), appended inside its braces.

- [ ] **Step 5: Add `referencesBase()` and the `references` sub-resource**

In `schema.ts`, add this private helper right after `instancesBase` (which closes with `}` on line 60):

```ts
  private referencesBase(): string {
    return `/schema/${this.ctx.tenant}/references`;
  }
```

Then append this member inside the class, after `searchInstances` and before the class's closing `}`:

```ts
  // --- (E) References ------------------------------------------------------

  /**
   * Reference entities (`/references`) — a schema plus an uploaded JSON file.
   * Create/update are `multipart/form-data` (parts `file` and `body`), like
   * {@link MediaService.create}. Default auth: service.
   */
  readonly references = {
    /**
     * List references, wrapped in {@link PaginatedItems}. Pagination defaults
     * match the rest of this service (`pageNumber: 1`, `pageSize: 60`).
     */
    list: async (
      query: ListSchemaReferencesQuery = {},
      auth: AuthContext = SERVICE,
    ): Promise<PaginatedItems<SchemaReference>> => {
      const pageNumber = query.pageNumber ?? 1;
      const pageSize = query.pageSize ?? 60;
      const q: Record<string, string | number> = { pageNumber, pageSize };
      if (query.sort) q.sort = query.sort;
      if (query.q) q.q = query.q;
      if (query.fields) q.fields = query.fields;
      if (query.type) q.type = query.type;
      const items = await this.ctx.http.request<SchemaReference[]>({
        method: "GET",
        path: this.referencesBase(),
        auth,
        query: q,
      });
      return { items, pageNumber, pageSize, hasNextPage: items.length === pageSize };
    },

    /** Retrieve one reference by id. */
    get: async (id: string, auth: AuthContext = SERVICE): Promise<SchemaReference> =>
      this.ctx.http.request<SchemaReference>({
        method: "GET",
        path: `${this.referencesBase()}/${encodeURIComponent(id)}`,
        auth,
      }),

    /**
     * Create a reference. `file` is the reference's JSON content — pass a
     * `Blob` to upload as-is, or a plain object to have it serialized into a
     * JSON blob. `body` carries the metadata.
     */
    create: async (
      input: { file: Blob | Record<string, unknown>; body: SchemaReferenceInput },
      auth: AuthContext = SERVICE,
    ): Promise<SchemaReferenceCreated> => {
      const fd = new FormData();
      fd.set("file", toJsonBlob(input.file));
      fd.set("body", JSON.stringify(input.body));
      return this.ctx.http.request<SchemaReferenceCreated>({
        method: "POST",
        path: this.referencesBase(),
        auth,
        body: fd,
      });
    },

    /**
     * Update a reference (multipart, like {@link create}). `options.version`
     * enables optimistic locking — the server answers 409 on a stale version.
     */
    update: async (
      id: string,
      input: { file: Blob | Record<string, unknown>; body: SchemaReferenceUpdateInput },
      options: { version?: number } = {},
      auth: AuthContext = SERVICE,
    ): Promise<void> => {
      const fd = new FormData();
      fd.set("file", toJsonBlob(input.file));
      fd.set("body", JSON.stringify(input.body));
      await this.ctx.http.request<void>({
        method: "PUT",
        path: `${this.referencesBase()}/${encodeURIComponent(id)}`,
        ...(options.version === undefined ? {} : { query: { version: options.version } }),
        auth,
        body: fd,
      });
    },

    /** Delete a reference by id. */
    delete: async (id: string, auth: AuthContext = SERVICE): Promise<void> => {
      await this.ctx.http.request<void>({
        method: "DELETE",
        path: `${this.referencesBase()}/${encodeURIComponent(id)}`,
        auth,
      });
    },
  };
```

Add this module-level helper just above the `SchemaService` class declaration (after the `SERVICE` const on line 38):

```ts
/** Passes a `Blob` through; serializes a plain object into a JSON blob. */
function toJsonBlob(file: Blob | Record<string, unknown>): Blob {
  return file instanceof Blob
    ? file
    : new Blob([JSON.stringify(file)], { type: "application/json" });
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk test -- schema-admin`
Expected: PASS (5 tests).

- [ ] **Step 7: Typecheck**

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/sdk/src/services/schema-types.ts packages/sdk/src/services/schema.ts packages/sdk/tests/services/schema-admin.test.ts
git commit -m "feat(sdk): add schema reference crud with multipart upload"
```

---

### Task 2: Instance bulk create / upsert / delete

**Files:**
- Modify: `packages/sdk/src/services/schema.ts` (three methods appended after `bulkPatchInstances`)
- Test: `packages/sdk/tests/services/schema-admin.test.ts` (append a describe block)

**Interfaces:**
- Consumes: the aliases from Task 1, existing `BulkInstanceResult`, `instancesBase(type)`, `SERVICE`.
- Produces:
  - `bulkCreateInstances(type: string, items: SchemaInstanceBulkCreateItem[], auth?: AuthContext): Promise<BulkInstanceResult>`
  - `bulkUpsertInstances(type: string, items: SchemaInstanceBulkUpsertItem[], auth?: AuthContext): Promise<BulkInstanceResult>`
  - `bulkDeleteInstances(type: string, ids: string[], auth?: AuthContext): Promise<BulkInstanceResult>`

- [ ] **Step 1: Write the failing test**

Append to `packages/sdk/tests/services/schema-admin.test.ts`:

```ts
describe("SchemaService instance bulk", () => {
  it("bulkCreate POSTs, bulkUpsert PUTs, bulkDelete DELETEs with an id-array body", async () => {
    const B = `${E}/product/instances/bulk`;

    const c = vi.fn().mockResolvedValue([{ index: 0, code: 201 }]);
    await svc(c).bulkCreateInstances("product", [{ name: { en: "a" } }] as never);
    expect(c).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST", path: B, body: [{ name: { en: "a" } }], auth: { kind: "service" } }),
    );

    const u = vi.fn().mockResolvedValue([{ index: 0, code: 200 }]);
    await svc(u).bulkUpsertInstances("product", [{ id: "i1" }] as never);
    expect(u).toHaveBeenCalledWith(
      expect.objectContaining({ method: "PUT", path: B, body: [{ id: "i1" }], auth: { kind: "service" } }),
    );

    const d = vi.fn().mockResolvedValue([{ index: 0, code: 204 }]);
    const res = await svc(d).bulkDeleteInstances("product", ["i1", "i2"]);
    expect(d).toHaveBeenCalledWith(
      expect.objectContaining({ method: "DELETE", path: B, body: ["i1", "i2"], auth: { kind: "service" } }),
    );
    expect(res).toEqual([{ index: 0, code: 204 }]);
  });

  it("escapes the type in the bulk path", async () => {
    const c = vi.fn().mockResolvedValue([]);
    await svc(c).bulkCreateInstances("my type", [] as never);
    expect(c).toHaveBeenCalledWith(
      expect.objectContaining({ path: `${E}/my%20type/instances/bulk` }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk test -- schema-admin`
Expected: FAIL — `bulkCreateInstances` is not a function.

- [ ] **Step 3: Add the bulk methods**

In `schema.ts`, append these three methods immediately after `bulkPatchInstances` (which closes with `}` on line 335):

```ts
  /**
   * Create multiple instances in one request
   * (`POST /custom-entities/{type}/instances/bulk`). Returns a 207 envelope:
   * a per-item result array — a 207 is success, individual failures live in
   * each item's `code`/`status`.
   */
  async bulkCreateInstances(
    type: string,
    items: SchemaInstanceBulkCreateItem[],
    auth: AuthContext = SERVICE,
  ): Promise<BulkInstanceResult> {
    return this.ctx.http.request<BulkInstanceResult>({
      method: "POST",
      path: `${this.instancesBase(type)}/bulk`,
      auth,
      body: items,
    });
  }

  /**
   * Upsert multiple instances in one request
   * (`PUT /custom-entities/{type}/instances/bulk`). Each item carries its `id`.
   * Returns the same 207 per-item envelope as {@link bulkCreateInstances}.
   */
  async bulkUpsertInstances(
    type: string,
    items: SchemaInstanceBulkUpsertItem[],
    auth: AuthContext = SERVICE,
  ): Promise<BulkInstanceResult> {
    return this.ctx.http.request<BulkInstanceResult>({
      method: "PUT",
      path: `${this.instancesBase(type)}/bulk`,
      auth,
      body: items,
    });
  }

  /**
   * Delete multiple instances by id
   * (`DELETE /custom-entities/{type}/instances/bulk`). Returns the same 207
   * per-item envelope as {@link bulkCreateInstances}.
   *
   * **Note:** the OpenAPI schema declares no request body for this operation,
   * but its description mandates one — "The IDs of items should be defined in
   * the request body as an array of strings" (example
   * `["firstId", "secondId"]`). The SDK follows the description and sends the
   * id array. Unverified against the live API.
   */
  async bulkDeleteInstances(
    type: string,
    ids: string[],
    auth: AuthContext = SERVICE,
  ): Promise<BulkInstanceResult> {
    return this.ctx.http.request<BulkInstanceResult>({
      method: "DELETE",
      path: `${this.instancesBase(type)}/bulk`,
      auth,
      body: ids,
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk test -- schema-admin`
Expected: PASS (7 tests total).

- [ ] **Step 5: Typecheck**

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/services/schema.ts packages/sdk/tests/services/schema-admin.test.ts
git commit -m "feat(sdk): add custom-instance bulk create, upsert and delete"
```

---

### Task 3: Custom-entity export / import

**Files:**
- Modify: `packages/sdk/src/services/schema.ts` (two methods appended after `bulkDeleteInstances`)
- Test: `packages/sdk/tests/services/schema-admin.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `SchemaExport`, `SchemaImportInput` from Task 1, `entitiesBase()`, `SERVICE`.
- Produces:
  - `exportCustomEntities(types: string[], auth?: AuthContext): Promise<SchemaExport>`
  - `importCustomEntities(input: SchemaImportInput, auth?: AuthContext): Promise<void>`

- [ ] **Step 1: Write the failing test**

Append to `packages/sdk/tests/services/schema-admin.test.ts`:

```ts
describe("SchemaService export/import", () => {
  it("exportCustomEntities POSTs the type array", async () => {
    const e = vi.fn().mockResolvedValue({ data: "YmFzZTY0", exportedAt: "2026-07-25T00:00:00Z" });
    const res = await svc(e).exportCustomEntities(["product", "recipe"]);
    expect(e).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: `${E}/export`,
        body: ["product", "recipe"],
        auth: { kind: "service" },
      }),
    );
    expect(res).toEqual({ data: "YmFzZTY0", exportedAt: "2026-07-25T00:00:00Z" });
  });

  it("importCustomEntities POSTs the data envelope", async () => {
    const i = vi.fn().mockResolvedValue(undefined);
    await svc(i).importCustomEntities({ data: "YmFzZTY0" });
    expect(i).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: `${E}/import`,
        body: { data: "YmFzZTY0" },
        auth: { kind: "service" },
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk test -- schema-admin`
Expected: FAIL — `exportCustomEntities` is not a function.

- [ ] **Step 3: Add the export/import methods**

In `schema.ts`, append after `bulkDeleteInstances` (from Task 2):

```ts
  /**
   * Export custom entities and their schemas
   * (`POST /custom-entities/export`). Pass the entity types to include; the
   * result carries a base64 `data` payload plus `exportedAt`.
   */
  async exportCustomEntities(types: string[], auth: AuthContext = SERVICE): Promise<SchemaExport> {
    return this.ctx.http.request<SchemaExport>({
      method: "POST",
      path: `${this.entitiesBase()}/export`,
      auth,
      body: types,
    });
  }

  /**
   * Import custom entities and their schemas
   * (`POST /custom-entities/import`) from the base64 `data` produced by
   * {@link exportCustomEntities}.
   */
  async importCustomEntities(input: SchemaImportInput, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "POST",
      path: `${this.entitiesBase()}/import`,
      auth,
      body: input,
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk test -- schema-admin`
Expected: PASS (9 tests total).

- [ ] **Step 5: Typecheck**

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/services/schema.ts packages/sdk/tests/services/schema-admin.test.ts
git commit -m "feat(sdk): add custom-entity export and import"
```

---

### Task 4: Changeset + full verification

**Files:**
- Create: `.changeset/schema-admin-crud.md`

**Interfaces:**
- Consumes: nothing new.
- Produces: the release changeset; a green full test/typecheck/build run.

- [ ] **Step 1: Write the changeset**

Create `.changeset/schema-admin-crud.md`:

```md
---
"@viu/emporix-sdk": minor
---

Complete the schema-service coverage in `client.schema`. New `schema.references`
sub-resource (`list`/`get`/`create`/`update`/`delete`) — create and update are
`multipart/form-data` uploads whose `file` part accepts a `Blob` or a plain
object (serialized to JSON). New instance bulk methods `bulkCreateInstances`,
`bulkUpsertInstances` and `bulkDeleteInstances` alongside the existing
`bulkPatchInstances`, plus `exportCustomEntities` / `importCustomEntities`.
Note: the OpenAPI schema declares no request body for the bulk delete, but its
description mandates an array of ids — the SDK follows the description and sends
one. All methods keep the service's service-token default.
```

- [ ] **Step 2: Run the full SDK unit suite**

Run: `pnpm -F @viu/emporix-sdk test`
Expected: PASS (existing suite + the new `schema-admin` tests).

- [ ] **Step 3: Repo-wide typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Build the SDK**

Run: `pnpm -F @viu/emporix-sdk build`
Expected: `dist/` written, no errors.

- [ ] **Step 5: Commit**

```bash
git add .changeset/schema-admin-crud.md
git commit -m "chore(sdk): add changeset for schema admin crud"
```

---

## Self-Review

**Spec coverage** — every missing operation maps to a task:

| Spec operation | Task |
|---|---|
| `references.list` (GET /references) | 1 |
| `references.get` (GET /references/{id}) | 1 |
| `references.create` (POST /references, multipart) | 1 |
| `references.update` (PUT /references/{id}, multipart) | 1 |
| `references.delete` (DELETE /references/{id}) | 1 |
| `bulkCreateInstances` (POST …/instances/bulk) | 2 |
| `bulkUpsertInstances` (PUT …/instances/bulk) | 2 |
| `bulkDeleteInstances` (DELETE …/instances/bulk) | 2 |
| `exportCustomEntities` (POST /custom-entities/export) | 3 |
| `importCustomEntities` (POST /custom-entities/import) | 3 |
| 8 type aliases + 1 query interface | 1 |
| Changeset (minor) | 4 |

10 new + 21 already wrapped = 31 = the service's full operation count. None
deprecated. ✓

**Placeholder scan:** no TBD/TODO; every code step shows complete code. ✓

**Type consistency:** method names match between tests and implementations
(`references.{list,get,create,update,delete}`, `bulkCreateInstances`,
`bulkUpsertInstances`, `bulkDeleteInstances`, `exportCustomEntities`,
`importCustomEntities`). All aliases are declared and re-exported in Task 1
before Tasks 2/3 consume them. Generated import names verified against
`src/generated/schema/types.gen.ts` (`ReferenceResponse`, `ReferenceCreation`,
`ReferenceUpdate`, `IdResponse`, `CustomInstanceCreation`,
`CustomInstanceUpdate`, `ExportImportRequest`, `ExportImportResponse`). No
`index.ts` edit needed — `src/schema.ts` is `export *` and `index.ts:245`
re-exports it. ✓

**Multipart correctness:** `HttpClient` already branches on
`body instanceof FormData` (`core/http.ts:128`, `:265`) and omits the JSON
`Content-Type` so `fetch` can set the multipart boundary — no HTTP-layer change
is needed. The part names (`file`, `body`) match both the spec's
`multipart/form-data` schema and `MediaService.create`. The `toJsonBlob` helper
keeps `Blob` inputs untouched, which the tests assert both ways. ✓

**Pagination consistency:** `references.list` uses `pageSize: 60` — this
service's default (`listSchemas`), not the 50 used elsewhere in the SDK. ✓

**Deliberate spec deviation:** `bulkDeleteInstances` sends a body the generated
type forbids (`body?: never`), following the operation's description. Documented
in the design doc, the method docstring, the changeset, and here — unverified
against the live API. ✓
