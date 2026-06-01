# Schema Service Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Emporix **Schema Service** as a single server-side core SDK service, `client.schemas`, covering schemas CRUD + file-validation (group A), types (group B), custom-entities CRUD (group C), and custom-instances CRUD + search (group D).

**Architecture:** Types are generated from the upstream OpenAPI via the existing `@hey-api/openapi-ts` pipeline; a thin public-types module re-aliases the generated shapes and overlays a generic `mixins` type on custom instances. One focused service class mirrors the four API groups, defaulting to the service (clientCredentials) token like `media`/`tenantConfig`. It is wired onto `EmporixClient` exactly like the other services.

**Tech Stack:** TypeScript, Vitest + MSW (Node), `@hey-api/openapi-ts`, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-06-01-schema-service-design.md`

**Precedent to mirror file-for-file:** the Configuration Service binding (`docs/superpowers/specs/2026-05-29-configuration-service-design.md`, `packages/sdk/src/services/tenant-config.ts`, `packages/sdk/src/services/configuration-types.ts`, `packages/sdk/tests/services/tenant-config.test.ts`). The `PaginatedItems` list pattern mirrors `packages/sdk/src/services/media.ts`.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/sdk/scripts/fetch-specs.ts` | add the `schema` spec URL to the fetch list |
| `packages/sdk/specs/schema.yml` | fetched OpenAPI (committed artifact) |
| `packages/sdk/src/generated/schema/{index.ts,types.gen.ts}` | generated types (committed artifact) |
| `packages/sdk/src/services/schema-types.ts` | public types: `Schema`, `SchemaAttribute`, `SchemaTypeName`, `CustomEntity`, `CustomInstance<T>`, the drafts, and query/search option interfaces |
| `packages/sdk/src/services/schema.ts` | `SchemaService` (all four groups) |
| `packages/sdk/src/schema.ts` | one-line facade re-export |
| `packages/sdk/src/core/logger.ts` | add `"schema"` to the `ServiceName` union |
| `packages/sdk/src/client.ts` | construct + expose `schemas` |
| `packages/sdk/src/index.ts` | re-export the facade |
| `packages/sdk/tests/services/schema-types.test.ts` | type-level tests |
| `packages/sdk/tests/services/schema.test.ts` | MSW tests |
| `packages/sdk/tests/services/schema-wiring.test.ts` | client wiring test |
| `docs/schema.md` | usage doc |
| `CLAUDE.md` | service-list update |
| `.changeset/schema-service.md` | release entry |

All commands run from the repo root: `/Users/dominic.fritschi/projects/viu/emporix-sdk`.

---

## Task 1: Generate Schema types (codegen)

**Files:**
- Modify: `packages/sdk/scripts/fetch-specs.ts`
- Create (generated): `packages/sdk/specs/schema.yml`, `packages/sdk/src/generated/schema/index.ts`, `packages/sdk/src/generated/schema/types.gen.ts`

- [ ] **Step 1: Add the spec entry**

In `packages/sdk/scripts/fetch-specs.ts`, add this line to the `SPECS` object (after the `configuration` entry):

```ts
  schema: `${BASE}/utilities/schema/api-reference/api.yml`,
```

(URL verified live → HTTP 200: `https://raw.githubusercontent.com/emporix/api-references/refs/heads/main/utilities/schema/api-reference/api.yml`.)

- [ ] **Step 2: Fetch + generate**

Run:
```bash
pnpm -F @viu/emporix-sdk fetch:specs
pnpm -F @viu/emporix-sdk generate
```
Expected: console prints `fetched schema (...bytes)` (the fetch script logs one line per spec) and the generate step writes `src/generated/schema/`.

- [ ] **Step 3: Verify the generated type names**

Run:
```bash
grep -nE "export type (SchemaResponse|Schema|SchemaAttribute|SchemaType|CustomEntityResponse|CustomEntity|CustomInstanceResponse|CustomInstance)\b" packages/sdk/src/generated/schema/types.gen.ts
```
Expected: matches for the response/attribute/type/instance shapes. **Record the actual emitted names** — Task 2's import must match them. Likely candidates (hey-api derives names from the OpenAPI `components.schemas` keys):
- response schema → `SchemaResponse` (fall back to `Schema` if that is the emitted name)
- attribute → `SchemaAttribute`
- type enum → `SchemaType`
- custom entity → `CustomEntityResponse` (fall back to `CustomEntity`)
- custom instance → `CustomInstanceResponse` (fall back to `CustomInstance`)

If a name differs, note it; Task 2 aliases the generated name to the public name, so only the **import target** changes, not the public surface.

- [ ] **Step 4: Confirm deferred groups are NOT bound (sanity)**

This plan deliberately omits references (E), export/import (F), and bulk instance ops. No action needed — just do not add methods for them. Optionally confirm the spec contains them (so the deferral is real, not a misread):
```bash
grep -nE "instances/bulk|/export|/import|references" packages/sdk/specs/schema.yml | head
```
Expected: matches exist (they are real endpoints we are intentionally skipping). If they are absent, that is fine too — there is simply nothing to defer.

- [ ] **Step 5: Keep the change focused**

Run `git status --short`. If `fetch:specs`/`generate` also touched other `specs/*.yml` or `src/generated/*` files (upstream drift unrelated to this feature), restore them so this PR stays scoped:
```bash
git restore packages/sdk/specs packages/sdk/src/generated
git restore --staged packages/sdk/specs packages/sdk/src/generated 2>/dev/null || true
```
Then re-run Step 2 and immediately stage just the schema paths in Step 6. (If `git status` showed only the new `schema` files, skip this step.)

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/scripts/fetch-specs.ts packages/sdk/specs/schema.yml packages/sdk/src/generated/schema
git commit -m "feat(sdk): generate schema service types"
```

---

## Task 2: Public types module

**Files:**
- Create: `packages/sdk/src/services/schema-types.ts`
- Test: `packages/sdk/tests/services/schema-types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/schema-types.test.ts`:

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  Schema,
  SchemaTypeName,
  CustomEntity,
  CustomInstance,
  SchemaDraft,
  CustomInstanceDraft,
  ListSchemasQuery,
  ListInstancesQuery,
  ListCustomEntitiesOptions,
} from "../../src/services/schema-types";

describe("schema types", () => {
  it("Schema exposes id, types and attributes", () => {
    expectTypeOf<Schema>().toHaveProperty("id");
    expectTypeOf<Schema>().toHaveProperty("types");
    expectTypeOf<Schema>().toHaveProperty("attributes");
  });

  it("SchemaTypeName includes the documented entity types", () => {
    const t: SchemaTypeName = "PRODUCT";
    expectTypeOf(t).toMatchTypeOf<SchemaTypeName>();
  });

  it("CustomInstance<T> types mixins as T", () => {
    const i: CustomInstance<{ size: number }> = {
      id: "i1",
      name: { en: "n" },
      type: "shoe",
      owner: { type: "TENANT", userId: "u" },
      mixins: { size: 42 },
      metadata: { version: 1 },
    };
    expectTypeOf(i.mixins).toEqualTypeOf<{ size: number }>();
  });

  it("CustomInstance defaults mixins to an object record", () => {
    expectTypeOf<CustomInstance>().toHaveProperty("mixins");
  });

  it("SchemaDraft has name/types/attributes", () => {
    const d: SchemaDraft = { name: { en: "Shoe" }, types: ["CUSTOM_ENTITY"], attributes: [] };
    expectTypeOf(d.types).toMatchTypeOf<SchemaTypeName[]>();
  });

  it("CustomInstanceDraft<T> types mixins as T", () => {
    const d: CustomInstanceDraft<{ size: number }> = {
      name: { en: "n" },
      mixins: { size: 1 },
    };
    expectTypeOf(d.mixins).toEqualTypeOf<{ size: number }>();
  });

  it("CustomEntity exposes id", () => {
    expectTypeOf<CustomEntity>().toHaveProperty("id");
  });

  it("query option interfaces expose the documented fields", () => {
    const s: ListSchemasQuery = { q: "name:x", type: "PRODUCT", pageNumber: 1, pageSize: 10 };
    expectTypeOf(s.type).toEqualTypeOf<SchemaTypeName | undefined>();
    const li: ListInstancesQuery = { pageNumber: 2, pageSize: 5 };
    expectTypeOf(li.pageSize).toEqualTypeOf<number | undefined>();
    const ce: ListCustomEntitiesOptions = { expandSchemas: true };
    expectTypeOf(ce.expandSchemas).toEqualTypeOf<boolean | undefined>();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/schema-types.test.ts`
Expected: FAIL — cannot find module `../../src/services/schema-types`.

- [ ] **Step 3: Write the types module**

Create `packages/sdk/src/services/schema-types.ts`. Adjust the imported names on the first line to whatever Task 1, Step 3 recorded (the example uses the likely names). The public type names below never change:

```ts
import type {
  SchemaResponse,
  SchemaAttribute as GenSchemaAttribute,
  SchemaType as GenSchemaType,
  CustomEntityResponse,
  CustomInstanceResponse,
} from "../generated/schema";

/** A schema definition (typed attributes attached to one or more entity types). */
export type Schema = SchemaResponse;

/** A single typed attribute within a schema (recursive for `OBJECT`). */
export type SchemaAttribute = GenSchemaAttribute;

/**
 * The set of native entity types a schema can attach to
 * (`PRODUCT`, `CART`, `ORDER`, `CUSTOM_ENTITY`, …).
 */
export type SchemaTypeName = GenSchemaType;

/** A custom-entity definition (a tenant-defined resource type). */
export type CustomEntity = CustomEntityResponse;

/**
 * A custom-entity data record. The wire `mixins` field is "any JSON object";
 * the SDK lets callers pin it with a generic (defaults to an open record).
 * All other fields mirror the upstream `CustomInstanceResponse` schema.
 */
export type CustomInstance<T = Record<string, unknown>> = Omit<
  CustomInstanceResponse,
  "mixins"
> & { mixins: T };

/**
 * Input for creating a schema (server assigns `metadata.version`/`url`).
 * `name`, `types` and `attributes` are the caller-controlled fields.
 */
export interface SchemaDraft {
  name: Record<string, string>;
  types: SchemaTypeName[];
  attributes: SchemaAttribute[];
}

/**
 * Input for updating a schema. Identical to {@link SchemaDraft} but the
 * upstream API **requires** `metadata.version` for optimistic locking
 * (409 Conflict on a stale version).
 */
export interface SchemaUpdate extends SchemaDraft {
  metadata: { version: number };
}

/** Input for creating/updating a custom-entity definition. */
export interface CustomEntityDraft {
  name: Record<string, string>;
  attributes: SchemaAttribute[];
}

/** Input for creating/replacing a custom instance. `mixins` carries the data. */
export interface CustomInstanceDraft<T = Record<string, unknown>> {
  name: Record<string, string>;
  mixins: T;
}

/** Filter / pagination options for {@link SchemaService.listSchemas}. */
export interface ListSchemasQuery {
  /** Emporix `q`-syntax filter (supports `compoundLogicalQuery`). */
  q?: string;
  /** Restrict to schemas attached to this entity type. */
  type?: SchemaTypeName;
  pageNumber?: number;
  pageSize?: number;
}

/**
 * Pagination options for {@link SchemaService.listInstances}. The index
 * signature stays open so additional Emporix query params pass through.
 */
export interface ListInstancesQuery {
  pageNumber?: number;
  pageSize?: number;
  [key: string]: string | number | undefined;
}

/** Options for {@link SchemaService.listCustomEntities}. */
export interface ListCustomEntitiesOptions {
  /** Inline each entity's schema body in the response. */
  expandSchemas?: boolean;
}

/** Structured search filter body for {@link SchemaService.searchInstances}. */
export type InstanceSearchBody = Record<string, unknown>;
```

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run:
```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/schema-types.test.ts
pnpm -F @viu/emporix-sdk typecheck
```
Expected: test PASS; typecheck exits 0.

> If typecheck fails because the generated module does not export `SchemaResponse`/`SchemaType`/etc under those exact names, change ONLY the import on the first line of `schema-types.ts` to the names recorded in Task 1, Step 3 (e.g. `import type { Schema as SchemaResponse } from "../generated/schema";`). Do not change the public type names.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/schema-types.ts packages/sdk/tests/services/schema-types.test.ts
git commit -m "feat(sdk): add schema public types"
```

---

## Task 3: SchemaService — schemas + types (groups A & B)

**Files:**
- Create: `packages/sdk/src/services/schema.ts`, `packages/sdk/src/schema.ts`
- Test: `packages/sdk/tests/services/schema.test.ts`

This task creates the service file with groups A and B; Task 4 appends groups C and D to the same file and test.

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/schema.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { SchemaService } from "../../src/services/schema";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { EmporixNotFoundError } from "../../src/core/errors";
import { MemoryLogger } from "../helpers/memory-logger";

const server = setupServer(
  http.post("https://api.emporix.io/oauth/token", () =>
    HttpResponse.json({ access_token: "svc-tok", token_type: "Bearer", expires_in: 3599 }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function svc() {
  const cfg = {
    tenant: "acme",
    host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "schema" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new SchemaService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const SCHEMAS = "https://api.emporix.io/schema/acme/schemas";
const TYPES = "https://api.emporix.io/schema/acme/types";

describe("SchemaService — schemas (group A)", () => {
  it("listSchemas GETs with a service token and a paginated envelope", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(SCHEMAS, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json([
          { id: "s1", name: { en: "Product extras" }, types: ["PRODUCT"], attributes: [], metadata: { version: 1 } },
        ]);
      }),
    );
    const page = await svc().listSchemas();
    expect(seenAuth).toBe("Bearer svc-tok");
    expect(page.items.map((s) => s.id)).toEqual(["s1"]);
    expect(page.pageNumber).toBe(1);
    expect(page.pageSize).toBe(60);
    expect(page.hasNextPage).toBe(false);
  });

  it("listSchemas serializes q/type/pagination into the query", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.get(SCHEMAS, ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json([]);
      }),
    );
    await svc().listSchemas({ q: "name:x", type: "PRODUCT", pageNumber: 2, pageSize: 5 });
    const params = q as URLSearchParams | null;
    expect(params?.get("q")).toBe("name:x");
    expect(params?.get("type")).toBe("PRODUCT");
    expect(params?.get("pageNumber")).toBe("2");
    expect(params?.get("pageSize")).toBe("5");
  });

  it("getSchema fetches one schema by id", async () => {
    server.use(
      http.get(`${SCHEMAS}/s1`, () =>
        HttpResponse.json({ id: "s1", name: { en: "n" }, types: ["PRODUCT"], attributes: [], metadata: { version: 3 } }),
      ),
    );
    const s = await svc().getSchema("s1");
    expect(s.metadata.version).toBe(3);
  });

  it("getSchema throws EmporixNotFoundError on 404", async () => {
    server.use(
      http.get(`${SCHEMAS}/missing`, () =>
        HttpResponse.json({ status: 404, message: "not found" }, { status: 404 }),
      ),
    );
    await expect(svc().getSchema("missing")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("createSchema POSTs the draft and returns the created schema", async () => {
    let body: unknown = null;
    server.use(
      http.post(SCHEMAS, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          { id: "s2", name: { en: "Extras" }, types: ["PRODUCT"], attributes: [], metadata: { version: 1 } },
          { status: 201 },
        );
      }),
    );
    const created = await svc().createSchema({ name: { en: "Extras" }, types: ["PRODUCT"], attributes: [] });
    expect(body).toEqual({ name: { en: "Extras" }, types: ["PRODUCT"], attributes: [] });
    expect(created.id).toBe("s2");
  });

  it("updateSchema PUTs the draft including metadata.version", async () => {
    let body: unknown = null;
    server.use(
      http.put(`${SCHEMAS}/s1`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "s1", name: { en: "n" }, types: ["PRODUCT"], attributes: [], metadata: { version: 4 } });
      }),
    );
    const updated = await svc().updateSchema("s1", {
      name: { en: "n" },
      types: ["PRODUCT"],
      attributes: [],
      metadata: { version: 3 },
    });
    expect(body).toEqual({ name: { en: "n" }, types: ["PRODUCT"], attributes: [], metadata: { version: 3 } });
    expect(updated.metadata.version).toBe(4);
  });

  it("deleteSchema DELETEs and resolves to void", async () => {
    server.use(http.delete(`${SCHEMAS}/s1`, () => new HttpResponse(null, { status: 204 })));
    await expect(svc().deleteSchema("s1")).resolves.toBeUndefined();
  });

  it("validateSchemaFile POSTs to /schemas/file without persisting", async () => {
    let path = "";
    let body: unknown = null;
    server.use(
      http.post(`${SCHEMAS}/file`, async ({ request }) => {
        path = new URL(request.url).pathname;
        body = await request.json();
        return HttpResponse.json({ valid: true });
      }),
    );
    const res = await svc().validateSchemaFile({ name: { en: "n" }, types: ["PRODUCT"], attributes: [] });
    expect(path).toBe("/schema/acme/schemas/file");
    expect(body).toEqual({ name: { en: "n" }, types: ["PRODUCT"], attributes: [] });
    expect(res).toEqual({ valid: true });
  });

  it("encodeURIComponent-escapes the schema id in the path", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/schema/acme/schemas/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({ id: "a/b", name: {}, types: [], attributes: [], metadata: { version: 0 } });
      }),
    );
    await svc().getSchema("a/b");
    expect(pathname).toBe("/schema/acme/schemas/a%2Fb");
  });
});

describe("SchemaService — types (group B)", () => {
  it("listTypes returns the populated-types array", async () => {
    server.use(http.get(TYPES, () => HttpResponse.json(["PRODUCT", "CART"])));
    expect(await svc().listTypes()).toEqual(["PRODUCT", "CART"]);
  });

  it("setSchemaTypes PUTs the types body to /schemas/{id}/types", async () => {
    let body: unknown = null;
    server.use(
      http.put(`${SCHEMAS}/s1/types`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "s1", name: {}, types: ["PRODUCT", "CART"], attributes: [], metadata: { version: 2 } });
      }),
    );
    const updated = await svc().setSchemaTypes("s1", ["PRODUCT", "CART"]);
    expect(body).toEqual({ types: ["PRODUCT", "CART"] });
    expect(updated.types).toEqual(["PRODUCT", "CART"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/schema.test.ts`
Expected: FAIL — cannot find module `../../src/services/schema`.

- [ ] **Step 3: Write the service (groups A & B)**

Create `packages/sdk/src/services/schema.ts`:

```ts
import type { ClientContext, PaginatedItems } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  Schema,
  SchemaDraft,
  SchemaUpdate,
  SchemaTypeName,
  ListSchemasQuery,
} from "./schema-types";

export type {
  Schema,
  SchemaAttribute,
  SchemaTypeName,
  SchemaDraft,
  SchemaUpdate,
  CustomEntity,
  CustomInstance,
  CustomEntityDraft,
  CustomInstanceDraft,
  ListSchemasQuery,
  ListInstancesQuery,
  ListCustomEntitiesOptions,
  InstanceSearchBody,
} from "./schema-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Schema Service (`/schema/{tenant}/…`): schemas, entity types, custom
 * entities and their instances. Requires the backend-only `schema.schema_*`
 * / `schema.custominstance_*` scopes — default auth: service. Server-side use
 * only; the service token must never reach a browser.
 */
export class SchemaService {
  constructor(private readonly ctx: ClientContext) {}

  private schemasBase(): string {
    return `/schema/${this.ctx.tenant}/schemas`;
  }

  // --- (A) Schemas ---------------------------------------------------------

  /**
   * List schemas, wrapped in the shared {@link PaginatedItems} envelope.
   * `hasNextPage` is the standard SDK heuristic (`items.length === pageSize`).
   * Pagination defaults match the rest of the SDK (`pageNumber: 1`,
   * `pageSize: 60`).
   */
  async listSchemas(
    query: ListSchemasQuery = {},
    auth: AuthContext = SERVICE,
  ): Promise<PaginatedItems<Schema>> {
    const pageNumber = query.pageNumber ?? 1;
    const pageSize = query.pageSize ?? 60;
    const q: Record<string, string | number> = { pageNumber, pageSize };
    if (query.q) q.q = query.q;
    if (query.type) q.type = query.type;
    const items = await this.ctx.http.request<Schema[]>({
      method: "GET",
      path: this.schemasBase(),
      auth,
      query: q,
    });
    return { items, pageNumber, pageSize, hasNextPage: items.length === pageSize };
  }

  /** Retrieve one schema by id. */
  async getSchema(id: string, auth: AuthContext = SERVICE): Promise<Schema> {
    return this.ctx.http.request<Schema>({
      method: "GET",
      path: `${this.schemasBase()}/${encodeURIComponent(id)}`,
      auth,
    });
  }

  /** Create a schema. */
  async createSchema(draft: SchemaDraft, auth: AuthContext = SERVICE): Promise<Schema> {
    return this.ctx.http.request<Schema>({
      method: "POST",
      path: this.schemasBase(),
      auth,
      body: draft,
    });
  }

  /**
   * Update a schema. The upstream API requires `draft.metadata.version`; a
   * stale version yields 409 Conflict (propagated as the standard conflict
   * error).
   */
  async updateSchema(
    id: string,
    draft: SchemaUpdate,
    auth: AuthContext = SERVICE,
  ): Promise<Schema> {
    return this.ctx.http.request<Schema>({
      method: "PUT",
      path: `${this.schemasBase()}/${encodeURIComponent(id)}`,
      auth,
      body: draft,
    });
  }

  /** Delete a schema by id. */
  async deleteSchema(id: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.schemasBase()}/${encodeURIComponent(id)}`,
      auth,
    });
  }

  /**
   * Validate a schema document without persisting it (`POST /schemas/file`).
   * Returns the server's validation result verbatim.
   */
  async validateSchemaFile<R = unknown>(
    body: SchemaDraft,
    auth: AuthContext = SERVICE,
  ): Promise<R> {
    return this.ctx.http.request<R>({
      method: "POST",
      path: `${this.schemasBase()}/file`,
      auth,
      body,
    });
  }

  // --- (B) Types -----------------------------------------------------------

  /** List entity types that currently have at least one schema. */
  async listTypes(auth: AuthContext = SERVICE): Promise<SchemaTypeName[]> {
    return this.ctx.http.request<SchemaTypeName[]>({
      method: "GET",
      path: `/schema/${this.ctx.tenant}/types`,
      auth,
    });
  }

  /** Set the entity types a schema applies to (`PUT /schemas/{id}/types`). */
  async setSchemaTypes(
    id: string,
    types: SchemaTypeName[],
    auth: AuthContext = SERVICE,
  ): Promise<Schema> {
    return this.ctx.http.request<Schema>({
      method: "PUT",
      path: `${this.schemasBase()}/${encodeURIComponent(id)}/types`,
      auth,
      body: { types },
    });
  }
}
```

Create the facade `packages/sdk/src/schema.ts`:

```ts
export * from "./services/schema";
```

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run:
```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/schema.test.ts
pnpm -F @viu/emporix-sdk typecheck
```
Expected: the group A & B tests PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/schema.ts packages/sdk/src/schema.ts packages/sdk/tests/services/schema.test.ts
git commit -m "feat(sdk): add schema service schemas and types methods"
```

---

## Task 4: SchemaService — custom entities + instances (groups C & D)

**Files:**
- Modify: `packages/sdk/src/services/schema.ts`
- Modify (append): `packages/sdk/tests/services/schema.test.ts`

- [ ] **Step 1: Append the failing tests**

Append these two `describe` blocks to `packages/sdk/tests/services/schema.test.ts` (after the existing blocks, before the file's final close — they reuse the `svc()` helper and the `server` already defined):

```ts
const ENTITIES = "https://api.emporix.io/schema/acme/custom-entities";

describe("SchemaService — custom entities (group C)", () => {
  it("listCustomEntities GETs the array and forwards expandSchemas", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.get(ENTITIES, ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json([{ id: "shoe", name: { en: "Shoe" }, attributes: [], metadata: { version: 1 } }]);
      }),
    );
    const rows = await svc().listCustomEntities({ expandSchemas: true });
    expect((q as URLSearchParams | null)?.get("expandSchemas")).toBe("true");
    expect(rows[0]?.id).toBe("shoe");
  });

  it("listCustomEntities omits the query when no options are given", async () => {
    let search = "x";
    server.use(
      http.get(ENTITIES, ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json([]);
      }),
    );
    await svc().listCustomEntities();
    expect(search).toBe("");
  });

  it("getCustomEntity fetches one by id", async () => {
    server.use(
      http.get(`${ENTITIES}/shoe`, () =>
        HttpResponse.json({ id: "shoe", name: { en: "Shoe" }, attributes: [], metadata: { version: 2 } }),
      ),
    );
    expect((await svc().getCustomEntity("shoe")).id).toBe("shoe");
  });

  it("createCustomEntity POSTs the draft", async () => {
    let body: unknown = null;
    server.use(
      http.post(ENTITIES, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "shoe", name: { en: "Shoe" }, attributes: [], metadata: { version: 1 } }, { status: 201 });
      }),
    );
    await svc().createCustomEntity({ name: { en: "Shoe" }, attributes: [] });
    expect(body).toEqual({ name: { en: "Shoe" }, attributes: [] });
  });

  it("updateCustomEntity PUTs the draft", async () => {
    let body: unknown = null;
    server.use(
      http.put(`${ENTITIES}/shoe`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "shoe", name: { en: "Sneaker" }, attributes: [], metadata: { version: 2 } });
      }),
    );
    const updated = await svc().updateCustomEntity("shoe", { name: { en: "Sneaker" }, attributes: [] });
    expect(body).toEqual({ name: { en: "Sneaker" }, attributes: [] });
    expect(updated.name).toEqual({ en: "Sneaker" });
  });

  it("deleteCustomEntity DELETEs and resolves to void", async () => {
    server.use(http.delete(`${ENTITIES}/shoe`, () => new HttpResponse(null, { status: 204 })));
    await expect(svc().deleteCustomEntity("shoe")).resolves.toBeUndefined();
  });
});

describe("SchemaService — custom instances (group D)", () => {
  const INSTANCES = `${ENTITIES}/shoe/instances`;

  it("listInstances GETs a paginated envelope for the type", async () => {
    server.use(
      http.get(INSTANCES, () =>
        HttpResponse.json([
          { id: "i1", name: { en: "n" }, type: "shoe", owner: { type: "TENANT", userId: "u" }, mixins: { size: 42 }, metadata: { version: 1 } },
        ]),
      ),
    );
    const page = await svc().listInstances<{ size: number }>("shoe");
    expect(page.items[0]?.mixins.size).toBe(42);
    expect(page.pageNumber).toBe(1);
    expect(page.pageSize).toBe(60);
  });

  it("getInstance fetches one instance by id with typed mixins", async () => {
    server.use(
      http.get(`${INSTANCES}/i1`, () =>
        HttpResponse.json({ id: "i1", name: { en: "n" }, type: "shoe", owner: { type: "TENANT", userId: "u" }, mixins: { size: 42 }, metadata: { version: 1 } }),
      ),
    );
    const inst = await svc().getInstance<{ size: number }>("shoe", "i1");
    expect(inst.mixins.size).toBe(42);
  });

  it("createInstance POSTs the draft", async () => {
    let body: unknown = null;
    server.use(
      http.post(INSTANCES, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "i2", name: { en: "n" }, type: "shoe", owner: { type: "TENANT", userId: "u" }, mixins: { size: 41 }, metadata: { version: 1 } }, { status: 201 });
      }),
    );
    const created = await svc().createInstance("shoe", { name: { en: "n" }, mixins: { size: 41 } });
    expect(body).toEqual({ name: { en: "n" }, mixins: { size: 41 } });
    expect(created.id).toBe("i2");
  });

  it("replaceInstance PUTs the full draft", async () => {
    let method = "";
    let body: unknown = null;
    server.use(
      http.put(`${INSTANCES}/i1`, async ({ request }) => {
        method = request.method;
        body = await request.json();
        return HttpResponse.json({ id: "i1", name: { en: "n2" }, type: "shoe", owner: { type: "TENANT", userId: "u" }, mixins: { size: 40 }, metadata: { version: 2 } });
      }),
    );
    await svc().replaceInstance("shoe", "i1", { name: { en: "n2" }, mixins: { size: 40 } });
    expect(method).toBe("PUT");
    expect(body).toEqual({ name: { en: "n2" }, mixins: { size: 40 } });
  });

  it("patchInstance PATCHes a partial body", async () => {
    let method = "";
    let body: unknown = null;
    server.use(
      http.patch(`${INSTANCES}/i1`, async ({ request }) => {
        method = request.method;
        body = await request.json();
        return HttpResponse.json({ id: "i1", name: { en: "n" }, type: "shoe", owner: { type: "TENANT", userId: "u" }, mixins: { size: 39 }, metadata: { version: 3 } });
      }),
    );
    await svc().patchInstance("shoe", "i1", { mixins: { size: 39 } });
    expect(method).toBe("PATCH");
    expect(body).toEqual({ mixins: { size: 39 } });
  });

  it("deleteInstance DELETEs and resolves to void", async () => {
    server.use(http.delete(`${INSTANCES}/i1`, () => new HttpResponse(null, { status: 204 })));
    await expect(svc().deleteInstance("shoe", "i1")).resolves.toBeUndefined();
  });

  it("searchInstances POSTs the filter to /instances/search and wraps the result", async () => {
    let path = "";
    let body: unknown = null;
    server.use(
      http.post(`${INSTANCES}/search`, async ({ request }) => {
        path = new URL(request.url).pathname;
        body = await request.json();
        return HttpResponse.json([
          { id: "i1", name: { en: "n" }, type: "shoe", owner: { type: "TENANT", userId: "u" }, mixins: { size: 42 }, metadata: { version: 1 } },
        ]);
      }),
    );
    const page = await svc().searchInstances("shoe", { size: { $gt: 40 } });
    expect(path).toBe("/schema/acme/custom-entities/shoe/instances/search");
    expect(body).toEqual({ size: { $gt: 40 } });
    expect(page.items[0]?.id).toBe("i1");
  });

  it("encodeURIComponent-escapes the type segment in the path", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/schema/acme/custom-entities/*/instances", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json([]);
      }),
    );
    await svc().listInstances("a/b");
    expect(pathname).toBe("/schema/acme/custom-entities/a%2Fb/instances");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/schema.test.ts`
Expected: FAIL — the new tests fail because `listCustomEntities`/`getInstance`/etc. are not methods on `SchemaService`.

- [ ] **Step 3: Append the methods (groups C & D)**

In `packages/sdk/src/services/schema.ts`, extend the import of value types used by the new methods. Change the first `import type` block to also pull in the instance/entity types:

```ts
import type {
  Schema,
  SchemaDraft,
  SchemaUpdate,
  SchemaTypeName,
  ListSchemasQuery,
  CustomEntity,
  CustomEntityDraft,
  CustomInstance,
  CustomInstanceDraft,
  ListInstancesQuery,
  ListCustomEntitiesOptions,
  InstanceSearchBody,
} from "./schema-types";
```

Add a private helper next to `schemasBase()`:

```ts
  private entitiesBase(): string {
    return `/schema/${this.ctx.tenant}/custom-entities`;
  }

  private instancesBase(type: string): string {
    return `${this.entitiesBase()}/${encodeURIComponent(type)}/instances`;
  }
```

Then append these methods inside the class (after `setSchemaTypes`):

```ts
  // --- (C) Custom entities -------------------------------------------------

  /** List custom-entity definitions. `expandSchemas` inlines each schema body. */
  async listCustomEntities(
    opts: ListCustomEntitiesOptions = {},
    auth: AuthContext = SERVICE,
  ): Promise<CustomEntity[]> {
    const query = opts.expandSchemas ? { expandSchemas: true } : undefined;
    return this.ctx.http.request<CustomEntity[]>({
      method: "GET",
      path: this.entitiesBase(),
      auth,
      ...(query ? { query } : {}),
    });
  }

  /** Retrieve one custom-entity definition by id. */
  async getCustomEntity(id: string, auth: AuthContext = SERVICE): Promise<CustomEntity> {
    return this.ctx.http.request<CustomEntity>({
      method: "GET",
      path: `${this.entitiesBase()}/${encodeURIComponent(id)}`,
      auth,
    });
  }

  /** Create a custom-entity definition. */
  async createCustomEntity(
    draft: CustomEntityDraft,
    auth: AuthContext = SERVICE,
  ): Promise<CustomEntity> {
    return this.ctx.http.request<CustomEntity>({
      method: "POST",
      path: this.entitiesBase(),
      auth,
      body: draft,
    });
  }

  /** Update a custom-entity definition. */
  async updateCustomEntity(
    id: string,
    draft: CustomEntityDraft,
    auth: AuthContext = SERVICE,
  ): Promise<CustomEntity> {
    return this.ctx.http.request<CustomEntity>({
      method: "PUT",
      path: `${this.entitiesBase()}/${encodeURIComponent(id)}`,
      auth,
      body: draft,
    });
  }

  /**
   * Delete a custom-entity definition. The server rejects with 409 if
   * instances or schemas still reference it (propagated as the standard
   * conflict error).
   */
  async deleteCustomEntity(id: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.entitiesBase()}/${encodeURIComponent(id)}`,
      auth,
    });
  }

  // --- (D) Custom instances ------------------------------------------------

  /**
   * List a custom entity's instances, wrapped in {@link PaginatedItems}.
   * `hasNextPage` uses the standard "page full" heuristic. `type` is the
   * custom-entity type and is always the first argument.
   */
  async listInstances<T = Record<string, unknown>>(
    type: string,
    query: ListInstancesQuery = {},
    auth: AuthContext = SERVICE,
  ): Promise<PaginatedItems<CustomInstance<T>>> {
    const pageNumber = query.pageNumber ?? 1;
    const pageSize = query.pageSize ?? 60;
    const items = await this.ctx.http.request<CustomInstance<T>[]>({
      method: "GET",
      path: this.instancesBase(type),
      auth,
      query: { ...query, pageNumber, pageSize },
    });
    return { items, pageNumber, pageSize, hasNextPage: items.length === pageSize };
  }

  /** Retrieve one instance by id. */
  async getInstance<T = Record<string, unknown>>(
    type: string,
    id: string,
    auth: AuthContext = SERVICE,
  ): Promise<CustomInstance<T>> {
    return this.ctx.http.request<CustomInstance<T>>({
      method: "GET",
      path: `${this.instancesBase(type)}/${encodeURIComponent(id)}`,
      auth,
    });
  }

  /** Create an instance of a custom entity. */
  async createInstance<T = Record<string, unknown>>(
    type: string,
    draft: CustomInstanceDraft<T>,
    auth: AuthContext = SERVICE,
  ): Promise<CustomInstance<T>> {
    return this.ctx.http.request<CustomInstance<T>>({
      method: "POST",
      path: this.instancesBase(type),
      auth,
      body: draft,
    });
  }

  /** Replace an instance (full `PUT`). */
  async replaceInstance<T = Record<string, unknown>>(
    type: string,
    id: string,
    draft: CustomInstanceDraft<T>,
    auth: AuthContext = SERVICE,
  ): Promise<CustomInstance<T>> {
    return this.ctx.http.request<CustomInstance<T>>({
      method: "PUT",
      path: `${this.instancesBase(type)}/${encodeURIComponent(id)}`,
      auth,
      body: draft,
    });
  }

  /** Partially update an instance (`PATCH`). */
  async patchInstance<T = Record<string, unknown>>(
    type: string,
    id: string,
    patch: Partial<CustomInstanceDraft<T>>,
    auth: AuthContext = SERVICE,
  ): Promise<CustomInstance<T>> {
    return this.ctx.http.request<CustomInstance<T>>({
      method: "PATCH",
      path: `${this.instancesBase(type)}/${encodeURIComponent(id)}`,
      auth,
      body: patch,
    });
  }

  /** Delete an instance by id. */
  async deleteInstance(type: string, id: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.instancesBase(type)}/${encodeURIComponent(id)}`,
      auth,
    });
  }

  /**
   * Structured search over a custom entity's instances
   * (`POST /instances/search`). The result is wrapped in
   * {@link PaginatedItems} using the standard "page full" heuristic.
   */
  async searchInstances<T = Record<string, unknown>>(
    type: string,
    body: InstanceSearchBody,
    auth: AuthContext = SERVICE,
  ): Promise<PaginatedItems<CustomInstance<T>>> {
    const items = await this.ctx.http.request<CustomInstance<T>[]>({
      method: "POST",
      path: `${this.instancesBase(type)}/search`,
      auth,
      body,
    });
    return {
      items,
      pageNumber: 1,
      pageSize: items.length,
      hasNextPage: false,
    };
  }
```

> **Note on `PATCH`:** confirm `request` supports `method: "PATCH"`. The HTTP layer forwards the method string to `fetch`, so PATCH works the same as the other verbs; no change to `core/http` is needed. If `pnpm typecheck` flags the method union, widen it where the other verbs are declared (search `"DELETE"` in `packages/sdk/src/core/http.ts`).

- [ ] **Step 2 (re-run): Run test + typecheck to verify they pass**

Run:
```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/schema.test.ts
pnpm -F @viu/emporix-sdk typecheck
```
Expected: all schema-service tests PASS; typecheck exits 0.

- [ ] **Step 3: Commit**

```bash
git add packages/sdk/src/services/schema.ts packages/sdk/tests/services/schema.test.ts
git commit -m "feat(sdk): add custom-entity and custom-instance methods to schema service"
```

---

## Task 5: Wire the service onto EmporixClient

**Files:**
- Modify: `packages/sdk/src/core/logger.ts`, `packages/sdk/src/client.ts`, `packages/sdk/src/index.ts`
- Test: `packages/sdk/tests/services/schema-wiring.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/schema-wiring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { SchemaService } from "../../src/services/schema";

describe("EmporixClient schema wiring", () => {
  it("exposes the schemas service", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.schemas).toBeInstanceOf(SchemaService);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/schema-wiring.test.ts`
Expected: FAIL — `sdk.schemas` is `undefined` (not an instance).

- [ ] **Step 3a: Extend the `ServiceName` union**

In `packages/sdk/src/core/logger.ts`, add `"schema"` to the `ServiceName` union (insert after `"configuration"`, before `"http"`):

```ts
  | "configuration"
  | "schema"
  | "http"
  | "auth";
```

- [ ] **Step 3b: Import and expose the service in `client.ts`**

In `packages/sdk/src/client.ts`, add the import next to the other service imports (after the `ClientConfigService` import):

```ts
import { SchemaService } from "./services/schema";
```

Add the readonly field after `clientConfig`:

```ts
  readonly schemas: SchemaService;
```

Construct it in the constructor after `this.clientConfig = ...`:

```ts
    this.schemas = new SchemaService(mk("schema"));
```

- [ ] **Step 3c: Re-export from the barrel**

In `packages/sdk/src/index.ts`, add this line after `export * from "./client-config";`:

```ts
export * from "./schema";
```

- [ ] **Step 4: Run the test, full suite + typecheck**

Run:
```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/schema-wiring.test.ts
pnpm -F @viu/emporix-sdk test
pnpm -F @viu/emporix-sdk typecheck
```
Expected: wiring test PASS; full suite PASS; typecheck exits 0.

> If `index.ts` reports a duplicate export (e.g. a generated `Schema` name colliding with another service's `Schema`), keep the barrel re-export but switch the conflicting public type alias in `schema-types.ts` — there is currently no other `Schema` export in `src/index.ts`, so this is unlikely. If it happens, prefix the public alias (e.g. keep `Schema` but the collision is on a generated helper) and re-run.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/core/logger.ts packages/sdk/src/client.ts packages/sdk/src/index.ts packages/sdk/tests/services/schema-wiring.test.ts
git commit -m "feat(sdk): expose schema service on the client"
```

---

## Task 6: Documentation

**Files:**
- Create: `docs/schema.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Write the usage doc**

Create `docs/schema.md`:

````markdown
# Schema Service

Bindings for the Emporix **Schema Service** (`/schema/{tenant}/…`): schemas
(typed attribute definitions on native entities), entity types, custom entities,
and custom-entity instances ("mixins" data).

> **Server-side only.** Every endpoint requires the backend
> `schema.schema_*` / `schema.custominstance_*` scopes, served by the
> **service (clientCredentials) token**. Never construct these calls from a
> browser — the admin token must not be exposed. Use them in Node, Next.js
> route handlers / server actions, or other trusted backends.

## Schemas — `client.schemas`

```ts
// list (paginated; optional q / type filter)
const page = await client.schemas.listSchemas({ type: "PRODUCT" });
for (const s of page.items) console.log(s.id, s.name);

// get one
const schema = await client.schemas.getSchema("product-extras");

// create
await client.schemas.createSchema({
  name: { en: "Product extras" },
  types: ["PRODUCT"],
  attributes: [{ key: "warranty", name: { en: "Warranty" }, type: "TEXT" }],
});

// update — metadata.version is REQUIRED (409 on a stale version)
await client.schemas.updateSchema("product-extras", {
  name: { en: "Product extras" },
  types: ["PRODUCT"],
  attributes: [],
  metadata: { version: schema.metadata.version },
});

// delete
await client.schemas.deleteSchema("product-extras");

// validate a schema document without persisting it
const result = await client.schemas.validateSchemaFile({
  name: { en: "Draft" }, types: ["PRODUCT"], attributes: [],
});
```

## Entity types

```ts
// types that currently have at least one schema
const types = await client.schemas.listTypes();

// set the entity types a schema applies to
await client.schemas.setSchemaTypes("product-extras", ["PRODUCT", "CART"]);
```

## Custom entities

```ts
const entities = await client.schemas.listCustomEntities({ expandSchemas: true });
const shoe = await client.schemas.getCustomEntity("shoe");
await client.schemas.createCustomEntity({ name: { en: "Shoe" }, attributes: [] });
await client.schemas.updateCustomEntity("shoe", { name: { en: "Sneaker" }, attributes: [] });
await client.schemas.deleteCustomEntity("shoe"); // 409 if instances/schemas still exist
```

## Custom instances

The custom-entity `type` is always the first argument. Pin the `mixins` shape
with a generic.

```ts
interface ShoeMixins { size: number; color: string }

const page = await client.schemas.listInstances<ShoeMixins>("shoe");
const one = await client.schemas.getInstance<ShoeMixins>("shoe", "instance-id");
await client.schemas.createInstance<ShoeMixins>("shoe", {
  name: { en: "Runner" },
  mixins: { size: 42, color: "black" },
});
await client.schemas.replaceInstance<ShoeMixins>("shoe", "instance-id", {
  name: { en: "Runner" },
  mixins: { size: 43, color: "black" },
});
await client.schemas.patchInstance<ShoeMixins>("shoe", "instance-id", {
  mixins: { size: 44, color: "black" },
});
await client.schemas.deleteInstance("shoe", "instance-id");

// structured search
const found = await client.schemas.searchInstances<ShoeMixins>("shoe", { /* filter body */ });
```

## Schema attribute types

`SchemaAttribute.type` is one of `TEXT`, `NUMBER`, `DECIMAL`, `BOOLEAN`,
`DATE`, `TIME`, `DATE_TIME`, `ENUM` (`values`), `ARRAY` (`arrayType`),
`OBJECT` (nested `attributes`), or `REFERENCE` (custom entities only). The
optional `metadata` carries `readOnly` / `localized` / `required` / `nullable`.

## Overriding the token

All methods take an optional trailing `auth` argument (default: the `"backend"`
service credential set). Pass `auth.service("other-set")` to use a different
configured credential set, or `auth.raw(token)` for a pre-obtained token.

## Not yet bound

Schema **references** (multipart upload/download), **export/import**, and
**bulk** instance operations are not yet exposed — see the design spec's
"Out of scope" section.
````

- [ ] **Step 2: Update CLAUDE.md service list**

In `CLAUDE.md`, find the `packages/sdk` row in the workspace-layout table and add `Schema` to the parenthesized service list (after `ClientConfig` if present, otherwise before the closing paren). The resulting list should end with `…, TenantConfig, ClientConfig, Schema)`. Use the Edit tool to append `, Schema` immediately before the `)` that closes the service list in that table row.

- [ ] **Step 3: Commit**

```bash
git add docs/schema.md CLAUDE.md
git commit -m "docs(sdk): document the schema service"
```

---

## Task 7: Changeset

**Files:**
- Create: `.changeset/schema-service.md`

- [ ] **Step 1: Write the changeset**

Create `.changeset/schema-service.md`:

```markdown
---
"@viu/emporix-sdk": minor
---

Add Schema Service bindings: `client.schemas` provides CRUD over schemas
(`listSchemas`/`getSchema`/`createSchema`/`updateSchema`/`deleteSchema`) plus
`validateSchemaFile`, entity types (`listTypes`/`setSchemaTypes`), custom
entities (`listCustomEntities`/`getCustomEntity`/`createCustomEntity`/
`updateCustomEntity`/`deleteCustomEntity`), and custom instances
(`listInstances`/`getInstance`/`createInstance`/`replaceInstance`/
`patchInstance`/`deleteInstance`/`searchInstances`). Server-side only — these
use the service (clientCredentials) token and must not be called from a
browser. References, export/import and bulk instance ops are not yet exposed.
```

- [ ] **Step 2: Verify the changeset is recognized**

Run: `pnpm changeset status --since=origin/main`
Expected: lists `@viu/emporix-sdk` for a minor bump, exit 0.

- [ ] **Step 3: Commit**

```bash
git add .changeset/schema-service.md
git commit -m "chore(release): add schema service changeset"
```

---

## Final verification (after all tasks)

- [ ] Run the full package suite + typecheck + lint:
```bash
pnpm -F @viu/emporix-sdk test
pnpm -F @viu/emporix-sdk typecheck
pnpm -F @viu/emporix-sdk lint
```
- [ ] Build so examples typecheck against the new dist surface:
```bash
pnpm -F @viu/emporix-sdk build
```
All expected to pass.

---

## Self-Review (performed while writing)

- **Spec coverage:** D1 groups A/B/C/D → Tasks 3 (A+B) and 4 (C+D), all
  methods present. D2 no React → no React tasks. D3 one service `client.schemas`
  → Task 5. D4 `delete*` names → `deleteSchema`/`deleteCustomEntity`/
  `deleteInstance` in Tasks 3/4. D5 generic `mixins` → `CustomInstance<T>` in
  Task 2, used in every instance method in Task 4. D6 codegen → Task 1. D7
  service-token default → `const SERVICE` in Task 3. D8 pagination →
  `PaginatedItems` for `listSchemas`/`listInstances`/`searchInstances`, plain
  arrays for `listCustomEntities`/`listTypes`. D9 `validateSchemaFile` → Task 3.
  D10 `type`-first arg → every instance method in Task 4. Out-of-scope (E/F/bulk)
  → never added; called out in docs (Task 6) and changeset (Task 7).
- **Placeholder scan:** No TBD/TODO; every code step has full code. The two
  upstream-dependent uncertainties (generated type names in Task 1/2; PATCH
  method-union support in Task 4) are concrete `grep`/typecheck checks with a
  defined fallback, not placeholders.
- **Type consistency:** `Schema` / `SchemaAttribute` / `SchemaTypeName` /
  `CustomEntity` / `CustomInstance` / the drafts / the query interfaces match
  across Tasks 2→3→4. Methods `listSchemas`/`getSchema`/`createSchema`/
  `updateSchema`/`deleteSchema`/`validateSchemaFile`/`listTypes`/
  `setSchemaTypes`/`listCustomEntities`/`getCustomEntity`/`createCustomEntity`/
  `updateCustomEntity`/`deleteCustomEntity`/`listInstances`/`getInstance`/
  `createInstance`/`replaceInstance`/`patchInstance`/`deleteInstance`/
  `searchInstances` are consistent between the service (Tasks 3/4), tests, and
  docs (Task 6). `request` (not `req`) used everywhere, matching `media.ts` /
  `tenant-config.ts`. The single facade `export * from "./services/schema"`
  re-exports both the class and the types (the service file re-exports the
  public types), so the barrel needs only one `export * from "./schema"` line.
- **Commit hygiene:** every commit scope is `sdk` (or `release` for the
  changeset) with a lowercase verb, per commitlint.
