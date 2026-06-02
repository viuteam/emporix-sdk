# Admin: Pick-Pack Service (Batch 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind the Pick-Pack Service as `client.pickPack` (12 ops).

**Architecture:** Types generated via `@hey-api/openapi-ts` and aliased in `pick-pack-types.ts`. One service class, service-token default, no React. Standard tenant base path.

**Tech Stack:** TypeScript, Vitest + MSW, `@hey-api/openapi-ts`, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-06-02-admin-pick-pack-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/sdk/scripts/fetch-specs.ts` | add `pick-pack` URL |
| `packages/sdk/specs/pick-pack.yml` | fetched OpenAPI |
| `packages/sdk/src/generated/pick-pack/` | generated types |
| `packages/sdk/src/services/pick-pack-types.ts` | public type aliases |
| `packages/sdk/src/services/pick-pack.ts` | `PickPackService` |
| `packages/sdk/src/pick-pack.ts` | facade re-export |
| `packages/sdk/src/core/logger.ts` | add `"pick-pack"` |
| `packages/sdk/src/client.ts` | construct + expose `pickPack` |
| `packages/sdk/src/index.ts` | re-export the facade |
| `packages/sdk/tests/services/pick-pack{,-types,-wiring}.test.ts` | tests |
| `docs/pick-pack.md` | usage doc |
| `CLAUDE.md` | service-list update |
| `.changeset/admin-pick-pack.md` | release entry (sdk only) |

All commands run from the repo root: `/Users/dominic.fritschi/projects/viu/emporix-sdk`.

**Branch:** create `feat/admin-pick-pack` off current `main`, commit spec + plan first:
```bash
git checkout main && git pull
git checkout -b feat/admin-pick-pack
git add docs/superpowers/specs/2026-06-02-admin-pick-pack-design.md docs/superpowers/plans/2026-06-02-admin-pick-pack.md
git commit -m "docs(sdk): add admin pick-pack design spec and plan"
```

---

## Task 1: Generate types (codegen)

- [ ] **Step 1:** in `fetch-specs.ts`, after `vendor-service`:
```ts
  "pick-pack": `${BASE}/orders/pick-pack/api-reference/api.yml`,
```
- [ ] **Step 2:** `pnpm -F @viu/emporix-sdk fetch:specs` then `generate`.
- [ ] **Step 3: Verify generated names** — record for Task 2:
```bash
grep -nE "^export type (Order|OrderStatusChange|PackagingProductsChange|Assignee|OrderEntryEventCreate|OrderEntryEventResponse|RecalculationJobCreation|RecalculationJob) =" packages/sdk/src/generated/pick-pack/types.gen.ts
grep -nE "body\??: [A-Za-z]|200: |201:|204:|url: '/pick-pack" packages/sdk/src/generated/pick-pack/types.gen.ts | head -40
```
Pin: mutating-method response codes (void vs body), `/orders` packlist envelope (array vs wrapper), `/orderCycles` response type, recalc-trigger response.
- [ ] **Step 4:** keep focused (restore unrelated drift; stage only `pick-pack`).
- [ ] **Step 5: Commit**
```bash
git add packages/sdk/scripts/fetch-specs.ts packages/sdk/specs/pick-pack.yml packages/sdk/src/generated/pick-pack
git commit -m "feat(sdk): generate pick-pack types"
```

---

## Task 2: PickPackService (types + service)

- [ ] **Step 1: `pick-pack-types.ts`** (swap names for the real generated ones):

```ts
import type {
  Order as GenOrder,
  Assignee as GenAssignee,
  OrderEntryEventResponse,
  RecalculationJobCreation,
  RecalculationJob as GenRecalculationJob,
} from "../generated/pick-pack";

/** Bodies re-exported with their generated names. */
export type { OrderStatusChange, PackagingProductsChange, OrderEntryEventCreate } from "../generated/pick-pack";

/** A pick-pack (fulfillment/packlist) order. */
export type PickOrder = GenOrder;
/** Packlist — list of pick-pack orders. */
export type PickOrderList = PickOrder[];
/** An order assignee. */
export type Assignee = GenAssignee;
/** A packing event (read). */
export type PackingEvent = OrderEntryEventResponse;
/** List of packing events. */
export type PackingEventList = PackingEvent[];
/** Order cycles list (`GET /orderCycles`). */
export type OrderCycleList = unknown[];
/** Body for `triggerRecalculation`. */
export type RecalculationJobInput = RecalculationJobCreation;
/** A recalculation job (read). */
export type RecalculationJob = GenRecalculationJob;
```

> Replace `OrderCycleList = unknown[]` with the generated `/orderCycles` response
> type if it is named. If `/orders` returns a paged envelope, set `PickOrderList`
> to it.

Type test `pick-pack-types.test.ts`: assert `PickOrder`/`PickOrderList`(array)/`Assignee`/`PackingEvent`/`RecalculationJob`/`RecalculationJobInput`/`OrderStatusChange` `not.toBeNever()`.

- [ ] **Step 2: Failing service test** — `pick-pack.test.ts` (`BASE = "https://api.emporix.io/pick-pack/acme"`):

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { PickPackService } from "../../src/services/pick-pack";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "pick-pack" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new PickPackService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/pick-pack/acme";

describe("PickPackService", () => {
  it("listOrders GETs the packlist with a service token", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(`${BASE}/orders`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json([{ orderId: "o1" }]);
      }),
    );
    await svc().listOrders();
    expect(seenAuth).toBe("Bearer svc-tok");
  });

  it("getOrder / updateOrder / finishOrder", async () => {
    let patchBody: unknown = null;
    server.use(
      http.get(`${BASE}/orders/o1`, () => HttpResponse.json({ orderId: "o1" })),
      http.patch(`${BASE}/orders/o1`, async ({ request }) => {
        patchBody = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
      http.post(`${BASE}/orders/o1/finish`, () => new HttpResponse(null, { status: 204 })),
    );
    expect((await svc().getOrder("o1")) as { orderId?: string }).toEqual({ orderId: "o1" });
    await expect(svc().updateOrder("o1", { status: "PACKED" } as never)).resolves.toBeUndefined();
    expect(patchBody).toEqual({ status: "PACKED" });
    await expect(svc().finishOrder("o1")).resolves.toBeUndefined();
  });

  it("getOrder throws EmporixNotFoundError on 404", async () => {
    server.use(http.get(`${BASE}/orders/NOPE`, () => HttpResponse.json({ status: 404, message: "x" }, { status: 404 })));
    await expect(svc().getOrder("NOPE")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("listOrderCycles GETs /orderCycles", async () => {
    server.use(http.get(`${BASE}/orderCycles`, () => HttpResponse.json([{ id: "cy1" }])));
    await expect(svc().listOrderCycles()).resolves.toBeDefined();
  });

  it("assignees: add + remove", async () => {
    let addBody: unknown = null;
    server.use(
      http.post(`${BASE}/orders/o1/assignees`, async ({ request }) => {
        addBody = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
      http.delete(`${BASE}/orders/o1/assignees/a1`, () => new HttpResponse(null, { status: 204 })),
    );
    await expect(svc().addAssignee("o1", { id: "a1" } as never)).resolves.toBeUndefined();
    expect(addBody).toEqual({ id: "a1" });
    await expect(svc().removeAssignee("o1", "a1")).resolves.toBeUndefined();
  });

  it("updatePackaging PUTs to /packaging", async () => {
    let body: unknown = null;
    server.use(
      http.put(`${BASE}/orders/o1/packaging`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(svc().updatePackaging("o1", { products: [] } as never)).resolves.toBeUndefined();
    expect(body).toEqual({ products: [] });
  });

  it("events: create + list", async () => {
    let createBody: unknown = null;
    server.use(
      http.post(`${BASE}/events`, async ({ request }) => {
        createBody = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
      http.get(`${BASE}/events`, () => HttpResponse.json([{ id: "e1" }])),
    );
    await expect(svc().createEvent({ type: "PACKED" } as never)).resolves.toBeUndefined();
    expect(createBody).toEqual({ type: "PACKED" });
    await expect(svc().listEvents()).resolves.toBeDefined();
  });

  it("recalculation: trigger + get job", async () => {
    server.use(
      http.post(`${BASE}/jobs/recalculations`, () => HttpResponse.json({ id: "j1" }, { status: 201 })),
      http.get(`${BASE}/jobs/recalculations/j1`, () => HttpResponse.json({ id: "j1" })),
    );
    expect(((await svc().triggerRecalculation({} as never)) as { id?: string }).id).toBe("j1");
    expect(((await svc().getRecalculationJob("j1")) as { id?: string }).id).toBe("j1");
  });

  it("encodeURIComponent-escapes the order id", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/pick-pack/acme/orders/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({});
      }),
    );
    await svc().getOrder("a/b");
    expect(pathname).toBe("/pick-pack/acme/orders/a%2Fb");
  });
});
```

> Adjust mutating-method mocks (204 vs body) and the recalc-trigger return per the
> codegen findings in Task 1.

- [ ] **Step 3: Write `pick-pack.ts` + facade**

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  PickOrder, PickOrderList, OrderStatusChange, PackagingProductsChange,
  Assignee, OrderEntryEventCreate, PackingEventList, OrderCycleList,
  RecalculationJobInput, RecalculationJob,
} from "./pick-pack-types";

export type {
  PickOrder, PickOrderList, OrderStatusChange, PackagingProductsChange,
  Assignee, OrderEntryEventCreate, PackingEvent, PackingEventList, OrderCycleList,
  RecalculationJobInput, RecalculationJob,
} from "./pick-pack-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Emporix Pick-Pack Service (`/pick-pack/{tenant}/…`): fulfillment/packlist
 * orders, assignees, packaging, packing events, and recalculation jobs.
 * Server-side; defaults to the service token.
 */
export class PickPackService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/pick-pack/${this.ctx.tenant}`;
  }

  private orderPath(orderId: string): string {
    return `${this.base()}/orders/${encodeURIComponent(orderId)}`;
  }

  /** List packlist orders. */
  async listOrders(query: Record<string, string | number> = {}, auth: AuthContext = SERVICE): Promise<PickOrderList> {
    return this.ctx.http.request<PickOrderList>({
      method: "GET",
      path: `${this.base()}/orders`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Retrieve a packlist order by id. */
  async getOrder(orderId: string, auth: AuthContext = SERVICE): Promise<PickOrder> {
    return this.ctx.http.request<PickOrder>({ method: "GET", path: this.orderPath(orderId), auth });
  }

  /** Update an order's status (`PATCH`). */
  async updateOrder(orderId: string, change: OrderStatusChange, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({ method: "PATCH", path: this.orderPath(orderId), auth, body: change });
  }

  /** Finish an order. */
  async finishOrder(orderId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({ method: "POST", path: `${this.orderPath(orderId)}/finish`, auth });
  }

  /** List order cycles. */
  async listOrderCycles(query: Record<string, string | number> = {}, auth: AuthContext = SERVICE): Promise<OrderCycleList> {
    return this.ctx.http.request<OrderCycleList>({
      method: "GET",
      path: `${this.base()}/orderCycles`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Add an assignee to an order. */
  async addAssignee(orderId: string, assignee: Assignee, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({ method: "POST", path: `${this.orderPath(orderId)}/assignees`, auth, body: assignee });
  }

  /** Remove an assignee from an order. */
  async removeAssignee(orderId: string, assigneeId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.orderPath(orderId)}/assignees/${encodeURIComponent(assigneeId)}`,
      auth,
    });
  }

  /** Update packaging products for an order (`PUT`). */
  async updatePackaging(orderId: string, change: PackagingProductsChange, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({ method: "PUT", path: `${this.orderPath(orderId)}/packaging`, auth, body: change });
  }

  /** Create a packing event. */
  async createEvent(event: OrderEntryEventCreate, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({ method: "POST", path: `${this.base()}/events`, auth, body: event });
  }

  /** List packing events. */
  async listEvents(query: Record<string, string | number> = {}, auth: AuthContext = SERVICE): Promise<PackingEventList> {
    return this.ctx.http.request<PackingEventList>({
      method: "GET",
      path: `${this.base()}/events`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Trigger an order recalculation. Returns the created job. */
  async triggerRecalculation(input: RecalculationJobInput, auth: AuthContext = SERVICE): Promise<RecalculationJob> {
    return this.ctx.http.request<RecalculationJob>({ method: "POST", path: `${this.base()}/jobs/recalculations`, auth, body: input });
  }

  /** Retrieve a recalculation job by id. */
  async getRecalculationJob(jobId: string, auth: AuthContext = SERVICE): Promise<RecalculationJob> {
    return this.ctx.http.request<RecalculationJob>({
      method: "GET",
      path: `${this.base()}/jobs/recalculations/${encodeURIComponent(jobId)}`,
      auth,
    });
  }
}
```

Facade `src/pick-pack.ts`: `export * from "./services/pick-pack";`

- [ ] **Step 4: Run tests + typecheck.** Drop `as never` where the aliased inputs accept the literals.

- [ ] **Step 5: Commit (two commits: types, service).**

```bash
git commit -m "feat(sdk): add pick-pack public types"
git commit -m "feat(sdk): add pick-pack service"
```

---

## Task 3: Wire onto EmporixClient

- [ ] **Step 1: Failing wiring test** — `pick-pack-wiring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { PickPackService } from "../../src/services/pick-pack";

describe("EmporixClient pick-pack wiring", () => {
  it("exposes the pick-pack service", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.pickPack).toBeInstanceOf(PickPackService);
  });
});
```

- [ ] **Step 2: Verify it fails.**
- [ ] **Step 3a: `ServiceName`** — add `| "pick-pack"` after `| "vendor"`.
- [ ] **Step 3b: `client.ts`** — import `PickPackService` after `VendorService`; field `readonly pickPack: PickPackService;` after `vendors`; construct `this.pickPack = new PickPackService(mk("pick-pack"));`.
- [ ] **Step 3c: barrel** — `export * from "./pick-pack";` after `export * from "./vendor";`.
- [ ] **Step 4: Run wiring test, full suite, typecheck, build.**
- [ ] **Step 5: Commit** — `feat(sdk): expose pick-pack service on the client`.

---

## Task 4: Documentation

- [ ] **Step 1:** Create `docs/pick-pack.md` (server-side note + method snippets; note these orders are fulfillment/packlist orders, distinct from `client.orders`).
- [ ] **Step 2: CLAUDE.md** — append `PickPack` to the service list.
- [ ] **Step 3: Commit** — `docs(sdk): document the pick-pack service`.

---

## Task 5: Changeset

- [ ] **Step 1: `.changeset/admin-pick-pack.md`**

```markdown
---
"@viu/emporix-sdk": minor
---

Add Emporix Pick-Pack Service bindings via `client.pickPack`: packlist orders
(`listOrders`, `getOrder`, `updateOrder`, `finishOrder`, `listOrderCycles`),
assignees (`addAssignee`, `removeAssignee`), packaging (`updatePackaging`),
packing events (`createEvent`, `listEvents`), and recalculation jobs
(`triggerRecalculation`, `getRecalculationJob`). Server-side only.
```

- [ ] **Step 2: Verify** — `pnpm changeset status` (adds `@viu/emporix-sdk`).
- [ ] **Step 3: Commit** — `chore(release): add pick-pack service changeset`.

---

## Final verification (after all tasks)

```bash
pnpm -F @viu/emporix-sdk test && pnpm -F @viu/emporix-sdk typecheck && pnpm -F @viu/emporix-sdk lint
pnpm -F @viu/emporix-sdk build
```

---

## Self-Review (performed while writing)

- **Spec coverage:** D1 full surface (12 ops) → Task 2 methods + tests. D2 one service → Task 3. D3 no React / service-token → `const SERVICE`. D4 codegen + aliasing (bodies re-exported as-is; read types aliased; mutating responses → void with codegen-verify notes; recalc trigger → `RecalculationJob`). Docs/changeset → Tasks 4/5 (sdk only). No gaps.
- **Placeholder scan:** No TBD/TODO in code steps. Upstream uncertainties (mutating response codes, `/orders` envelope, `/orderCycles` type, recalc-trigger response) are concrete codegen-verify notes with fallbacks.
- **Type consistency:** Public names identical across the types module, the service imports + re-exports, and the tests. Base path `/pick-pack/${tenant}` matches the spec + tests. Logger `"pick-pack"` matches `mk("pick-pack")` + the `ServiceName` addition. `orderPath()` helper centralizes the `/orders/{id}` prefix. Commit scopes `sdk`/`release`, lowercase verbs (commitlint-safe).
```
