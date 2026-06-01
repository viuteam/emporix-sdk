# Sequential ID Service Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-side core SDK binding for the Emporix Sequential ID Service as a single service, `client.sequentialIds`, covering schema CRUD + set-active and next-id generation (single + batch).

**Architecture:** Types are generated from the upstream OpenAPI via the existing `@hey-api/openapi-ts` pipeline; a thin public-types module aliases the generated shapes and hand-types the two open-map batch shapes. One focused service class binds all endpoints, defaulting to the service (clientCredentials) token like `media`/`tenant-config`. It is wired onto `EmporixClient` exactly like the other services.

**Tech Stack:** TypeScript, Vitest + MSW (Node), `@hey-api/openapi-ts`, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-06-01-sequential-id-service-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/sdk/scripts/fetch-specs.ts` | add the `"sequential-id"` spec URL to the fetch list |
| `packages/sdk/specs/sequential-id.yml` | fetched OpenAPI (committed artifact) |
| `packages/sdk/src/generated/sequential-id/{index.ts,types.gen.ts}` | generated types (committed artifact) |
| `packages/sdk/src/services/sequential-id-types.ts` | public types: `SequenceSchema`, `SequenceSchemaCreate`, `NextIdCommandRequest`, `NextIdResponse`, `NextIdOptions`, `BatchNextIdEntry`, `NextIdsBatchRequest`, `NextIdsBatchResponse` |
| `packages/sdk/src/services/sequential-id.ts` | `SequentialIdService` |
| `packages/sdk/src/sequential-id.ts` | one-line facade re-export |
| `packages/sdk/src/core/logger.ts` | add `"sequential-id"` to the `ServiceName` union |
| `packages/sdk/src/client.ts` | construct + expose `sequentialIds` |
| `packages/sdk/src/index.ts` | re-export the facade |
| `packages/sdk/tests/services/sequential-id-types.test.ts` | type-level tests |
| `packages/sdk/tests/services/sequential-id.test.ts` | MSW tests |
| `packages/sdk/tests/services/sequential-id-wiring.test.ts` | client wiring test |
| `docs/sequential-id.md` | usage doc |
| `CLAUDE.md` | service-list update |
| `.changeset/sequential-id-service.md` | release entry |

All commands run from the repo root: `/Users/dominic.fritschi/projects/viu/emporix-sdk`.

---

## Task 1: Generate Sequential ID types (codegen)

**Files:**
- Modify: `packages/sdk/scripts/fetch-specs.ts`
- Create (generated): `packages/sdk/specs/sequential-id.yml`, `packages/sdk/src/generated/sequential-id/index.ts`, `packages/sdk/src/generated/sequential-id/types.gen.ts`

- [ ] **Step 1: Add the spec entry**

In `packages/sdk/scripts/fetch-specs.ts`, add this line to the `SPECS` object (after the `configuration` entry):

```ts
  "sequential-id": `${BASE}/utilities/sequential-id/api-reference/api.yml`,
```

(URL verified live → HTTP 200: `https://raw.githubusercontent.com/emporix/api-references/refs/heads/main/utilities/sequential-id/api-reference/api.yml`.)

- [ ] **Step 2: Fetch + generate**

Run:
```bash
pnpm -F @viu/emporix-sdk fetch:specs
pnpm -F @viu/emporix-sdk generate
```
Expected: console prints `fetched sequential-id (...bytes)` among the other lines, and the generate step completes without error.

- [ ] **Step 3: Verify the generated type names**

Run:
```bash
grep -nE "export type (SequenceSchema|SequenceSchemaCreate|NextIdCommandRequest|NextIdResponse)\b" packages/sdk/src/generated/sequential-id/types.gen.ts
```
Expected: matches for `SequenceSchema`, `SequenceSchemaCreate`, `NextIdCommandRequest`, `NextIdResponse`. **Task 2 imports exactly these four names.** If hey-api emitted different names (e.g. a `…Read`/`…Write` suffix), note the actual names — Task 2's import + aliases must match them. Also run:
```bash
grep -niE "sequenceSchemaBatch|nextIds" packages/sdk/specs/sequential-id.yml | head
```
Expected: confirms the batch path `/sequential-id/sequenceSchemaBatch/nextIds` (no `{tenant}`) and that no PATCH/PUT schema-update path exists (immutable schemas). If the batch path differs, update Task 3's `nextIdsBatch` path.

- [ ] **Step 4: Keep the change focused**

Run `git status --short`. If `fetch:specs`/`generate` also touched unrelated `specs/*.yml` or `src/generated/*` files (upstream drift), restore them so this PR stays scoped:
```bash
git restore packages/sdk/specs packages/sdk/src/generated
git restore --staged packages/sdk/specs packages/sdk/src/generated 2>/dev/null || true
```
Then re-run Step 2 and stage only the `sequential-id` outputs in Step 5. (If `git status` showed only the new `sequential-id` files, skip this step.)

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/scripts/fetch-specs.ts packages/sdk/specs/sequential-id.yml packages/sdk/src/generated/sequential-id
git commit -m "feat(sdk): generate sequential id service types"
```

---

## Task 2: Public types module

**Files:**
- Create: `packages/sdk/src/services/sequential-id-types.ts`
- Test: `packages/sdk/tests/services/sequential-id-types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/sequential-id-types.test.ts`:

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  SequenceSchema,
  SequenceSchemaCreate,
  NextIdCommandRequest,
  NextIdResponse,
  NextIdOptions,
  BatchNextIdEntry,
  NextIdsBatchRequest,
  NextIdsBatchResponse,
} from "../../src/services/sequential-id-types";

describe("sequential id types", () => {
  it("SequenceSchemaCreate carries the required counter fields", () => {
    const c: SequenceSchemaCreate = {
      name: "order",
      startValue: 1,
      maxValue: 999999,
      numberOfDigits: 6,
    };
    expectTypeOf(c.name).toEqualTypeOf<string>();
    expectTypeOf(c.startValue).toEqualTypeOf<number>();
  });

  it("SequenceSchema is assignable from a server response with id + active", () => {
    const s: SequenceSchema = {
      id: "sch_1",
      name: "order",
      startValue: 1,
      maxValue: 999999,
      numberOfDigits: 6,
      active: true,
    } as SequenceSchema;
    expectTypeOf(s.id).toEqualTypeOf<string>();
  });

  it("NextIdCommandRequest and NextIdResponse have the expected shapes", () => {
    const req: NextIdCommandRequest = { sequenceKey: "store-1", placeholders: { yy: "26" } };
    const res: NextIdResponse = { id: "ORD-000123" };
    expectTypeOf(req.placeholders).toEqualTypeOf<Record<string, string> | undefined>();
    expectTypeOf(res.id).toEqualTypeOf<string>();
  });

  it("NextIdOptions.siteCode is optional string", () => {
    const o: NextIdOptions = { siteCode: "main" };
    expectTypeOf(o.siteCode).toEqualTypeOf<string | undefined>();
  });

  it("batch request/response are keyed maps", () => {
    const entry: BatchNextIdEntry = { numberOfIds: 3, sequenceKey: "store-1" };
    const req: NextIdsBatchRequest = { order: entry };
    const res: NextIdsBatchResponse = { order: { ids: ["ORD-1", "ORD-2", "ORD-3"] } };
    expectTypeOf(req.order).toEqualTypeOf<BatchNextIdEntry>();
    expectTypeOf(res.order.ids).toEqualTypeOf<string[]>();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/sequential-id-types.test.ts`
Expected: FAIL — cannot find module `../../src/services/sequential-id-types`.

- [ ] **Step 3: Write the types module**

Create `packages/sdk/src/services/sequential-id-types.ts`:

```ts
import type {
  SequenceSchema as GenSequenceSchema,
  SequenceSchemaCreate as GenSequenceSchemaCreate,
  NextIdCommandRequest as GenNextIdCommandRequest,
  NextIdResponse as GenNextIdResponse,
} from "../generated/sequential-id";

/**
 * A sequence schema as returned by the service — a counter template plus the
 * server-managed `id`, `active` flag, `counter`, and `metadata`.
 */
export type SequenceSchema = GenSequenceSchema;

/**
 * Body for {@link SequentialIdService.createSchema}. Schemas are immutable
 * (no PATCH/PUT upstream) — to change one, delete it and create a new one.
 */
export type SequenceSchemaCreate = GenSequenceSchemaCreate;

/** Body for a single next-id request: optional sub-pool key + placeholder values. */
export type NextIdCommandRequest = GenNextIdCommandRequest;

/** The generated id wrapper returned by `nextId`. */
export type NextIdResponse = GenNextIdResponse;

/** Per-call options for {@link SequentialIdService.nextId}. */
export interface NextIdOptions {
  /**
   * A site code. When set, the service derives time/country placeholders from
   * that site's settings. Serialized to the `?siteCode=` query param.
   */
  siteCode?: string;
}

/** One entry in a batch next-ids request, keyed by schema type. */
export interface BatchNextIdEntry {
  /** How many ids to allocate for this schema type. */
  numberOfIds: number;
  /** Optional independent sub-pool counter key. */
  sequenceKey?: string;
  /** Placeholder values substituted into the generated ids. */
  placeholders?: Record<string, string>;
}

/** Batch next-ids request: a map of `schemaType` → allocation request. */
export type NextIdsBatchRequest = Record<string, BatchNextIdEntry>;

/** Batch next-ids response: a map of `schemaType` → the generated ids. */
export type NextIdsBatchResponse = Record<string, { ids: string[] }>;
```

If Task 1, Step 3 reported different generated names, change the four import aliases accordingly (e.g. `SequenceSchemaResponse as GenSequenceSchema`).

> **Note on `NextIdResponse`:** if the generator does not emit a named `NextIdResponse` type (some specs inline the `{ id: string }` 200 body), replace its alias with a hand-written `export interface NextIdResponse { id: string }` and drop that import. Confirm via the Step 3 grep.

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run:
```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/sequential-id-types.test.ts
pnpm -F @viu/emporix-sdk typecheck
```
Expected: test PASS; typecheck exits 0. (If the `SequenceSchema` cast test fails because the generated type requires more fields, extend the literal in the test to satisfy it — the assertion only checks `id` is `string`.)

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/sequential-id-types.ts packages/sdk/tests/services/sequential-id-types.test.ts
git commit -m "feat(sdk): add sequential id public types"
```

---

## Task 3: SequentialIdService

**Files:**
- Create: `packages/sdk/src/services/sequential-id.ts`, `packages/sdk/src/sequential-id.ts`
- Test: `packages/sdk/tests/services/sequential-id.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/sequential-id.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { SequentialIdService } from "../../src/services/sequential-id";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "sequential-id" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new SequentialIdService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const SCHEMAS = "https://api.emporix.io/sequential-id/acme/schemas";

describe("SequentialIdService", () => {
  it("listSchemas GETs all schemas with a service token", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(SCHEMAS, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json([{ id: "sch_1", name: "order", active: true }]);
      }),
    );
    const rows = await svc().listSchemas();
    expect(seenAuth).toBe("Bearer svc-tok");
    expect(rows[0]?.id).toBe("sch_1");
  });

  it("getSchema fetches one schema by id", async () => {
    server.use(
      http.get(`${SCHEMAS}/sch_1`, () => HttpResponse.json({ id: "sch_1", name: "order", active: true })),
    );
    const s = await svc().getSchema("sch_1");
    expect(s.name).toBe("order");
  });

  it("getSchema throws EmporixNotFoundError on 404", async () => {
    server.use(
      http.get(`${SCHEMAS}/missing`, () =>
        HttpResponse.json({ status: 404, message: "not found" }, { status: 404 }),
      ),
    );
    await expect(svc().getSchema("missing")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("createSchema POSTs the body and returns the created schema", async () => {
    let body: unknown = null;
    server.use(
      http.post(SCHEMAS, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "sch_2", name: "invoice", active: false }, { status: 201 });
      }),
    );
    const created = await svc().createSchema({
      name: "invoice",
      startValue: 1,
      maxValue: 999999,
      numberOfDigits: 6,
    });
    expect(body).toEqual({ name: "invoice", startValue: 1, maxValue: 999999, numberOfDigits: 6 });
    expect(created.id).toBe("sch_2");
  });

  it("deleteSchema DELETEs and resolves to void", async () => {
    server.use(http.delete(`${SCHEMAS}/sch_1`, () => new HttpResponse(null, { status: 204 })));
    await expect(svc().deleteSchema("sch_1")).resolves.toBeUndefined();
  });

  it("setActiveSchema POSTs /setActive and resolves to void", async () => {
    let hit = false;
    server.use(
      http.post(`${SCHEMAS}/sch_1/setActive`, () => {
        hit = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(svc().setActiveSchema("sch_1")).resolves.toBeUndefined();
    expect(hit).toBe(true);
  });

  it("listSchemasByType GETs the active schema for a type", async () => {
    server.use(
      http.get(`${SCHEMAS}/types/order`, () => HttpResponse.json({ id: "sch_1", name: "order", active: true })),
    );
    const s = await svc().listSchemasByType("order");
    expect(s.id).toBe("sch_1");
  });

  it("nextId POSTs the body and omits siteCode when not provided", async () => {
    let body: unknown = null;
    let search = "x";
    server.use(
      http.post(`${SCHEMAS}/types/order/nextId`, async ({ request }) => {
        body = await request.json();
        search = new URL(request.url).search;
        return HttpResponse.json({ id: "ORD-000123" });
      }),
    );
    const res = await svc().nextId("order", { sequenceKey: "store-1" });
    expect(body).toEqual({ sequenceKey: "store-1" });
    expect(search).toBe("");
    expect(res.id).toBe("ORD-000123");
  });

  it("nextId serializes ?siteCode= when provided", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.post(`${SCHEMAS}/types/order/nextId`, ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json({ id: "ORD-000124" });
      }),
    );
    await svc().nextId("order", {}, { siteCode: "main" });
    expect((q as URLSearchParams | null)?.get("siteCode")).toBe("main");
  });

  it("nextIdsBatch POSTs to a tenant-less batch path and returns the id map", async () => {
    let pathname = "";
    let body: unknown = null;
    server.use(
      http.post("https://api.emporix.io/sequential-id/sequenceSchemaBatch/nextIds", async ({ request }) => {
        pathname = new URL(request.url).pathname;
        body = await request.json();
        return HttpResponse.json({ order: { ids: ["ORD-1", "ORD-2"] } });
      }),
    );
    const res = await svc().nextIdsBatch({ order: { numberOfIds: 2 } });
    expect(pathname).toBe("/sequential-id/sequenceSchemaBatch/nextIds");
    expect(body).toEqual({ order: { numberOfIds: 2 } });
    expect(res.order?.ids).toEqual(["ORD-1", "ORD-2"]);
  });

  it("encodeURIComponent-escapes the schema type in the path", async () => {
    let pathname = "";
    server.use(
      http.post("https://api.emporix.io/sequential-id/acme/schemas/types/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({ id: "X" });
      }),
    );
    await svc().nextId("a/b");
    expect(pathname).toBe("/sequential-id/acme/schemas/types/a%2Fb/nextId");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/sequential-id.test.ts`
Expected: FAIL — cannot find module `../../src/services/sequential-id`.

- [ ] **Step 3: Write the service**

Create `packages/sdk/src/services/sequential-id.ts`:

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  SequenceSchema,
  SequenceSchemaCreate,
  NextIdCommandRequest,
  NextIdResponse,
  NextIdOptions,
  NextIdsBatchRequest,
  NextIdsBatchResponse,
} from "./sequential-id-types";

export type {
  SequenceSchema,
  SequenceSchemaCreate,
  NextIdCommandRequest,
  NextIdResponse,
  NextIdOptions,
  BatchNextIdEntry,
  NextIdsBatchRequest,
  NextIdsBatchResponse,
} from "./sequential-id-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Sequential ID Service (`/sequential-id/{tenant}/…`): server-managed,
 * gap-free sequential identifiers (order/invoice numbers, etc.) driven by
 * tenant-defined sequence schemas.
 *
 * Requires the backend-only `sequentialid.schema_view` (read + next-id) /
 * `sequentialid.schema_manage` (CRUD + set-active) scopes — default auth:
 * service. Server-side use only; the service token must never reach a browser.
 *
 * Schemas are immutable upstream (no PATCH/PUT): to change one, `deleteSchema`
 * then `createSchema`. The `maxValue` is a hard cap with no auto-reset, and
 * only one schema may be active per type.
 */
export class SequentialIdService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/sequential-id/${this.ctx.tenant}/schemas`;
  }

  /** List all sequence schemas for the tenant. */
  async listSchemas(auth: AuthContext = SERVICE): Promise<SequenceSchema[]> {
    return this.ctx.http.request<SequenceSchema[]>({
      method: "GET",
      path: this.base(),
      auth,
    });
  }

  /** Retrieve one sequence schema by id. */
  async getSchema(schemaId: string, auth: AuthContext = SERVICE): Promise<SequenceSchema> {
    return this.ctx.http.request<SequenceSchema>({
      method: "GET",
      path: `${this.base()}/${encodeURIComponent(schemaId)}`,
      auth,
    });
  }

  /** Create a sequence schema. Schemas are immutable — there is no update. */
  async createSchema(
    schema: SequenceSchemaCreate,
    auth: AuthContext = SERVICE,
  ): Promise<SequenceSchema> {
    return this.ctx.http.request<SequenceSchema>({
      method: "POST",
      path: this.base(),
      auth,
      body: schema,
    });
  }

  /** Delete a sequence schema by id. */
  async deleteSchema(schemaId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/${encodeURIComponent(schemaId)}`,
      auth,
    });
  }

  /** Mark a schema active for its type (only one schema may be active per type). */
  async setActiveSchema(schemaId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "POST",
      path: `${this.base()}/${encodeURIComponent(schemaId)}/setActive`,
      auth,
    });
  }

  /** Get the active schema for a given schema type. */
  async listSchemasByType(schemaType: string, auth: AuthContext = SERVICE): Promise<SequenceSchema> {
    return this.ctx.http.request<SequenceSchema>({
      method: "GET",
      path: `${this.base()}/types/${encodeURIComponent(schemaType)}`,
      auth,
    });
  }

  /**
   * Generate the next id for a schema type. `body` carries an optional
   * `sequenceKey` (independent sub-pool counter) and `placeholders`.
   * `opts.siteCode` derives time/country placeholders from the site's settings.
   */
  async nextId(
    schemaType: string,
    body: NextIdCommandRequest = {},
    opts: NextIdOptions = {},
    auth: AuthContext = SERVICE,
  ): Promise<NextIdResponse> {
    const query = opts.siteCode ? { siteCode: opts.siteCode } : undefined;
    return this.ctx.http.request<NextIdResponse>({
      method: "POST",
      path: `${this.base()}/types/${encodeURIComponent(schemaType)}/nextId`,
      auth,
      body,
      ...(query ? { query } : {}),
    });
  }

  /**
   * Generate next ids for multiple schema types in one call. NOTE: the batch
   * endpoint path omits the `{tenant}` segment — the service derives the
   * tenant from the token.
   */
  async nextIdsBatch(
    req: NextIdsBatchRequest,
    auth: AuthContext = SERVICE,
  ): Promise<NextIdsBatchResponse> {
    return this.ctx.http.request<NextIdsBatchResponse>({
      method: "POST",
      path: `/sequential-id/sequenceSchemaBatch/nextIds`,
      auth,
      body: req,
    });
  }
}
```

Create the facade `packages/sdk/src/sequential-id.ts`:

```ts
export * from "./services/sequential-id";
```

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run:
```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/sequential-id.test.ts
pnpm -F @viu/emporix-sdk typecheck
```
Expected: all tests PASS; typecheck exits 0.

> **Note:** if the generated `SequenceSchemaCreate` requires fields the test literal omits (e.g. `schemaType`), either add them to the test literal or confirm they are optional in `types.gen.ts`. The body-equality assertions must match exactly what the service sends (the service passes `schema` through verbatim).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/sequential-id.ts packages/sdk/src/sequential-id.ts packages/sdk/tests/services/sequential-id.test.ts
git commit -m "feat(sdk): add sequential id service"
```

---

## Task 4: Wire the service onto EmporixClient

**Files:**
- Modify: `packages/sdk/src/core/logger.ts`, `packages/sdk/src/client.ts`, `packages/sdk/src/index.ts`
- Test: `packages/sdk/tests/services/sequential-id-wiring.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/sequential-id-wiring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { SequentialIdService } from "../../src/services/sequential-id";

describe("EmporixClient sequential id wiring", () => {
  it("exposes the sequentialIds service", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.sequentialIds).toBeInstanceOf(SequentialIdService);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/sequential-id-wiring.test.ts`
Expected: FAIL — `sdk.sequentialIds` is `undefined` (not an instance).

- [ ] **Step 3a: Extend the `ServiceName` union**

In `packages/sdk/src/core/logger.ts`, add `"sequential-id"` to the `ServiceName` union (insert after `"configuration"`, before `"http"`):

```ts
  | "configuration"
  | "sequential-id"
  | "http"
  | "auth";
```

- [ ] **Step 3b: Import and expose the service in `client.ts`**

In `packages/sdk/src/client.ts`, add the import next to the other service imports (after the `ClientConfigService` import):

```ts
import { SequentialIdService } from "./services/sequential-id";
```

Add the readonly field next to the other service fields (after `clientConfig`):

```ts
  readonly sequentialIds: SequentialIdService;
```

Construct it in the constructor next to the other `this.x = new XService(mk(...))` lines (after `this.clientConfig = ...`):

```ts
    this.sequentialIds = new SequentialIdService(mk("sequential-id"));
```

- [ ] **Step 3c: Re-export from the barrel**

In `packages/sdk/src/index.ts`, add this line next to the other `export * from "./<facade>"` lines (after `export * from "./client-config";`):

```ts
export * from "./sequential-id";
```

- [ ] **Step 4: Run the test, full suite + typecheck**

Run:
```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/sequential-id-wiring.test.ts
pnpm -F @viu/emporix-sdk test
pnpm -F @viu/emporix-sdk typecheck
```
Expected: wiring test PASS; full suite PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/core/logger.ts packages/sdk/src/client.ts packages/sdk/src/index.ts packages/sdk/tests/services/sequential-id-wiring.test.ts
git commit -m "feat(sdk): expose sequential id service on the client"
```

---

## Task 5: Documentation

**Files:**
- Create: `docs/sequential-id.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Write the usage doc**

Create `docs/sequential-id.md`:

````markdown
# Sequential ID Service

Bindings for the Emporix **Sequential ID Service** (`/sequential-id/{tenant}/…`):
server-managed, gap-free sequential identifiers (order numbers, invoice numbers,
etc.) generated from tenant-defined **sequence schemas**.

> **Server-side only.** Every endpoint requires the backend
> `sequentialid.schema_view` (read + next-id) / `sequentialid.schema_manage`
> (CRUD + set-active) scopes, served by the **service (clientCredentials)
> token**. Never construct these calls from a browser — the admin token must
> not be exposed. Use them in Node, Next.js route handlers / server actions, or
> other trusted backends.

## Schema admin — `client.sequentialIds`

```ts
// list all schemas
const schemas = await client.sequentialIds.listSchemas();

// create a schema (immutable — no update; delete + recreate to change)
const created = await client.sequentialIds.createSchema({
  name: "Order numbers",
  schemaType: "order",
  preText: "ORD-",
  startValue: 1,
  maxValue: 999999,
  numberOfDigits: 6,
});

// get one by id
const one = await client.sequentialIds.getSchema(created.id);

// mark a schema active for its type (only one active per type)
await client.sequentialIds.setActiveSchema(created.id);

// the active schema for a type
const active = await client.sequentialIds.listSchemasByType("order");

// delete
await client.sequentialIds.deleteSchema(created.id);
```

## Generating ids

```ts
// next id for a type (optional sub-pool key + placeholders)
const { id } = await client.sequentialIds.nextId("order", {
  sequenceKey: "store-1",
  placeholders: { yy: "26" },
});

// derive time/country placeholders from a site's settings
await client.sequentialIds.nextId("order", {}, { siteCode: "main" });

// batch: allocate several ids across schema types in one call
const batch = await client.sequentialIds.nextIdsBatch({
  order: { numberOfIds: 3 },
  invoice: { numberOfIds: 1, sequenceKey: "eu" },
});
batch.order.ids; // ["ORD-000123", "ORD-000124", "ORD-000125"]
```

## Quirks

- **`maxValue` is a hard cap** — there is no auto-reset; allocation fails once
  the counter reaches it.
- **One active schema per type** — `setActiveSchema` switches which schema a
  type's `nextId` calls use.
- **Schemas are immutable** — the API has no PATCH/PUT. To change a schema,
  delete it and create a new one.
- **`sequenceKey`** creates an independent sub-pool counter under the same schema.
- **Batch path has no tenant segment** — `nextIdsBatch` posts to
  `/sequential-id/sequenceSchemaBatch/nextIds`; the service derives the tenant
  from the token. (The SDK handles this for you.)

## Overriding the token

All methods take an optional trailing `auth` argument (default: the `"backend"`
service credential set). Pass `auth.service("other-set")` to use a different
configured credential set, or `auth.raw(token)` for a pre-obtained token.
````

- [ ] **Step 2: Update CLAUDE.md service list**

In `CLAUDE.md`, find the `packages/sdk` row in the workspace-layout table and add `SequentialId` to the parenthesized service list before the closing paren (after the last existing service entry).

- [ ] **Step 3: Commit**

```bash
git add docs/sequential-id.md CLAUDE.md
git commit -m "docs(sdk): document the sequential id service"
```

---

## Task 6: Changeset

**Files:**
- Create: `.changeset/sequential-id-service.md`

- [ ] **Step 1: Write the changeset**

Create `.changeset/sequential-id-service.md`:

```markdown
---
"@viu/emporix-sdk": minor
---

Add Sequential ID Service binding: `client.sequentialIds` provides sequence
schema admin (`listSchemas`/`getSchema`/`createSchema`/`deleteSchema`/
`setActiveSchema`/`listSchemasByType`) and id generation (`nextId`,
`nextIdsBatch`). Server-side only — these use the service (clientCredentials)
token and must not be called from a browser.
```

- [ ] **Step 2: Verify the changeset is recognized**

Run: `pnpm changeset status --since=origin/main`
Expected: lists `@viu/emporix-sdk` for a minor bump, exit 0.

- [ ] **Step 3: Commit**

```bash
git add .changeset/sequential-id-service.md
git commit -m "chore(release): add sequential id service changeset"
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

- **Spec coverage:** D1 schema CRUD + set-active + next-id (single + batch) →
  Task 3 binds all eight methods. D2 no React → no React tasks. D3 one service
  `sequentialIds` → wired in Task 4. D4 `deleteSchema` name → used in Task 3.
  D5 codegen + thin aliases → Tasks 1+2. D6 service-token default → `const SERVICE`
  in Task 3. D7 batch path without tenant → `nextIdsBatch` path + its dedicated
  test asserting `pathname === "/sequential-id/sequenceSchemaBatch/nextIds"`.
  D8 optional `siteCode` → `nextId` `opts` arg + two tests (omitted vs present).
  Tests section → Tasks 2/3/4. Docs/changeset → Tasks 5/6. No gaps.
- **Placeholder scan:** No TBD/TODO; every code step has full code. The only
  upstream-dependent uncertainties (generated type names; whether `NextIdResponse`
  is named or inlined; whether `SequenceSchemaCreate` fields are required) are
  concrete `grep` verifications in Task 1/2 with defined fallbacks, not placeholders.
- **Type consistency:** `SequenceSchema` / `SequenceSchemaCreate` /
  `NextIdCommandRequest` / `NextIdResponse` / `NextIdOptions` / `BatchNextIdEntry`
  / `NextIdsBatchRequest` / `NextIdsBatchResponse` names match across Tasks 2→3.
  Methods `listSchemas`/`getSchema`/`createSchema`/`deleteSchema`/`setActiveSchema`/
  `listSchemasByType`/`nextId`/`nextIdsBatch` consistent between the service, the
  tests, and the docs. `request` (not `req`) used everywhere, matching `media.ts`
  / `tenant-config.ts`. The conditional `...(query ? { query } : {})` spread
  mirrors `tenant-config.ts` so `RequestOptions.query` stays `undefined`-free.
- **Path correctness:** every tenant-scoped path begins `/sequential-id/${tenant}/schemas`;
  the batch path intentionally omits `${tenant}`, asserted directly in the test.
  `encodeURIComponent` applied to `schemaId` + `schemaType`, asserted by the
  escape test.
