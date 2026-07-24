# order-v2 SalesOrders Admin + Legal-Entity B2B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the `salesorders` + `legal-entity-orders` coverage of `order-v2.yml` by extending `SalesOrdersService` (11 methods) and `OrdersService` (2 legal-entity reads) in `packages/sdk/src/services/orders.ts`.

**Architecture:** Flat methods on the two existing classes — no new classes, no client wiring, no constructor change. New public types are aliases defined in `services/orders.ts` and re-exported via the `src/orders.ts` barrel (explicit named exports). `SalesOrdersService` methods take a required `auth` (matching existing `get`/`update`); `OrdersService` legal-entity reads take a required customer `auth` (matching `listMine`/`get`). Paginated reads wrap the bare generated array into `PaginatedItems` like `listMine`.

**Tech Stack:** TypeScript, Vitest (`vi.fn()`-mocked `http.request`), `@hey-api/openapi-ts`-generated types under `src/generated/order-v2`.

## Global Constraints

- Package: `@viu/emporix-sdk`. Release bump: **minor** (additive).
- HTTP: `this.ctx.http.request<T>({ method, path, query?, body?, headers?, auth })`.
- `SalesOrdersService.base()` = `` `/order-v2/${this.ctx.tenant}/salesorders` ``. Legal-entity paths are NOT under a base — write `` `/order-v2/${this.ctx.tenant}/legal-entity-orders/...` `` inline in `OrdersService`.
- **Auth is always a required positional arg** (no default) on every new method — matching the existing methods in each class.
- Paginated lists wrap the bare `SalesOrder[]` into `PaginatedItems` (`{ items, pageNumber, pageSize, hasNextPage: items.length === pageSize }`) exactly like `OrdersService.listMine`.
- `q` filters resolve via `resolveQuery(q, { compoundLogicalQuery: false })`, entity `"ORDER"`. Use the existing module-level `setIfDefined` helper for optional query params.
- **Commit scope must be `sdk`** — `order`/`orders` are NOT in the commitlint scope-enum. Subject's first word is a lowercase verb.
- Do NOT modify existing methods. The existing `SalesOrdersService.update` is a **PATCH** (partial); the new `replace` is the **PUT** (full) — keep both.

## File Structure

- **Modify** `packages/sdk/src/services/orders.ts` — extend the generated-type import, add type aliases + two option interfaces, add 11 methods to `SalesOrdersService` and 2 to `OrdersService`.
- **Modify** `packages/sdk/src/orders.ts` (barrel) — add the new type/interface names to the `./services/orders` named export.
- **Create** `packages/sdk/tests/services/orders-admin.test.ts` — `vi.fn()`-mocked path/method/auth assertions.
- **Create** `.changeset/order-v2-salesorders-legal-entity.md` — minor changeset.

---

### Task 1: Types + SalesOrders CRUD (list / search / create / replace / delete)

**Files:**
- Modify: `packages/sdk/src/services/orders.ts` (import line 4; aliases + interfaces after line 40; methods appended to `SalesOrdersService`)
- Modify: `packages/sdk/src/orders.ts` (barrel export)
- Test: `packages/sdk/tests/services/orders-admin.test.ts` (create)

**Interfaces:**
- Consumes: existing `SalesOrdersService(ctx)`, `base()`, `AuthContext`, `PaginatedItems`, `resolveQuery`/`QueryFor`, `setIfDefined`.
- Produces (all new type aliases + both option interfaces, so later tasks and the barrel edit are done once):
  - `type SalesOrderCreateInput`, `SalesOrderCreated`, `SalesOrderReplaceInput`, `SalesOrderSearchInput`, `SalesOrderHistoricalTransitions`, `SalesOrderCalculationInput`, `SalesOrderEntriesInput`, `SalesOrderSplitInput`, `SalesOrderSplitResult`
  - `interface ListSalesOrdersOptions`, `ListLegalEntityOrdersOptions`
  - `SalesOrdersService.list(auth, opts?: ListSalesOrdersOptions): Promise<PaginatedItems<SalesOrder>>`
  - `search(query: SalesOrderSearchInput, auth: AuthContext, opts?: { pageNumber?: number; pageSize?: number; sort?: string; fields?: string }): Promise<SalesOrder[]>`
  - `create(input: SalesOrderCreateInput, auth: AuthContext): Promise<SalesOrderCreated>`
  - `replace(orderId: string, input: SalesOrderReplaceInput, auth: AuthContext): Promise<SalesOrder>`
  - `delete(orderId: string, auth: AuthContext): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/orders-admin.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { SalesOrdersService, OrdersService } from "../../src/services/orders";

function ctxWith(request: ReturnType<typeof vi.fn>) {
  return {
    tenant: "acme",
    http: { request },
    tokenProvider: { getToken: vi.fn() },
    logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}
const so = (req: ReturnType<typeof vi.fn>): SalesOrdersService => new SalesOrdersService(ctxWith(req));
const os = (req: ReturnType<typeof vi.fn>): OrdersService => new OrdersService(ctxWith(req));
const SB = "/order-v2/acme/salesorders";
const LEB = "/order-v2/acme/legal-entity-orders";
const SVC = { kind: "service" } as const;
const CUST = { kind: "customer", token: "T" } as const;

describe("SalesOrdersService CRUD", () => {
  it("list wraps the array into PaginatedItems and forwards auth + paging", async () => {
    const l = vi.fn().mockResolvedValue([{ id: "o1" }]);
    const res = await so(l).list(SVC, { pageSize: 10, q: "status:COMPLETED" });
    expect(l).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: SB,
        auth: { kind: "service" },
        query: expect.objectContaining({ pageNumber: 1, pageSize: 10, q: "status:COMPLETED" }),
      }),
    );
    expect(res).toEqual({ items: [{ id: "o1" }], pageNumber: 1, pageSize: 10, hasNextPage: false });
  });

  it("search POSTs /salesorders/search with the body and returns the array", async () => {
    const s = vi.fn().mockResolvedValue([{ id: "o1" }]);
    const res = await so(s).search({ q: "status:COMPLETED" } as never, SVC);
    expect(s).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: `${SB}/search`, body: { q: "status:COMPLETED" }, auth: SVC }));
    expect(res).toEqual([{ id: "o1" }]);
  });

  it("create POSTs /salesorders and returns the ResourceLocation", async () => {
    const c = vi.fn().mockResolvedValue({ id: "o1" });
    const res = await so(c).create({} as never, SVC);
    expect(c).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: SB, body: {}, auth: SVC }));
    expect(res).toEqual({ id: "o1" });
  });

  it("replace PUTs /salesorders/{id} then re-fetches the sales-order", async () => {
    const r = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce({ id: "o1" });
    const res = await so(r).replace("o1", {} as never, SVC);
    expect(r.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ method: "PUT", path: `${SB}/o1`, body: {}, auth: SVC }));
    expect(r.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ method: "GET", path: `${SB}/o1`, auth: SVC }));
    expect(res).toEqual({ id: "o1" });
  });

  it("delete DELETEs /salesorders/{id}", async () => {
    const d = vi.fn().mockResolvedValue(undefined);
    await so(d).delete("o1", SVC);
    expect(d).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: `${SB}/o1`, auth: SVC }));
  });
});
```

(`os`, `LEB`, `CUST` are used by Task 3's block appended to the same file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk test -- orders-admin`
Expected: FAIL — `list`/`search`/`create`/`replace`/`delete` are not functions.

- [ ] **Step 3: Extend the generated-type import**

In `packages/sdk/src/services/orders.ts`, replace line 4:

```ts
import type { Order, OrderStatus, OrderUpdateDto } from "../generated/order-v2";
```

with:

```ts
import type {
  Order,
  OrderStatus,
  OrderUpdateDto,
  SalesOrder,
  Transition,
  SalesOrderCreationDto,
  ResourceLocation,
  SearchRequest,
  HistoricalTransitionsResponse,
  OrderCalculationDto,
  OrderEntriesDto,
  OrderSplitRequest,
  OrderSplitResponse,
} from "../generated/order-v2";
```

- [ ] **Step 4: Add the type aliases and option interfaces**

In `orders.ts`, immediately after the `SalesOrderPatch` type (line 11) — before `ListMyOrdersOptions`:

```ts
/** Body for creating a sales-order as an employee (`POST /salesorders`). */
export type SalesOrderCreateInput = SalesOrderCreationDto;

/** Id/location envelope returned when a sales-order is created. */
export type SalesOrderCreated = ResourceLocation;

/** Body for a full sales-order replace (`PUT /salesorders/{id}`). */
export type SalesOrderReplaceInput = OrderUpdateDto;

/** Body for `salesOrders.search` (`POST /salesorders/search`). */
export type SalesOrderSearchInput = SearchRequest;

/** Response of `salesOrders.listHistoricalTransitions`. */
export type SalesOrderHistoricalTransitions = HistoricalTransitionsResponse;

/** Body for `salesOrders.calculate` (`POST /salesorders/{id}/calculations`). */
export type SalesOrderCalculationInput = OrderCalculationDto;

/** Body for `salesOrders.updateEntries` (`POST /salesorders/{id}/entries`). */
export type SalesOrderEntriesInput = OrderEntriesDto;

/** Body for `salesOrders.split` (`POST /salesorders/{id}/split`). */
export type SalesOrderSplitInput = OrderSplitRequest;

/** Response of `salesOrders.split`. */
export type SalesOrderSplitResult = OrderSplitResponse;

/** Options for `salesOrders.list`. */
export interface ListSalesOrdersOptions {
  pageNumber?: number;
  pageSize?: number;
  sort?: string;
  fields?: string;
  /** A `q` filter — raw DSL string or a built filter for entity "ORDER". */
  q?: QueryFor<"ORDER">;
}

/** Options for `orders.listForLegalEntity`. */
export interface ListLegalEntityOrdersOptions {
  pageNumber?: number;
  pageSize?: number;
  sort?: string;
  saasToken?: string;
  /** A `q` filter — raw DSL string or a built filter for entity "ORDER". */
  q?: QueryFor<"ORDER">;
}
```

- [ ] **Step 5: Add the CRUD methods**

Append inside the `SalesOrdersService` class, after `update` (the last method) and before the class's closing brace:

```ts
  /** Lists tenant sales-orders (`GET /salesorders`), wrapped into `PaginatedItems`. */
  async list(auth: AuthContext, opts: ListSalesOrdersOptions = {}): Promise<PaginatedItems<SalesOrder>> {
    const pageNumber = opts.pageNumber ?? 1;
    const pageSize = opts.pageSize ?? 50;
    const query: Record<string, string | number | undefined> = { pageNumber, pageSize };
    setIfDefined(query, "sort", opts.sort);
    setIfDefined(query, "fields", opts.fields);
    if (opts.q !== undefined) {
      setIfDefined(query, "q", resolveQuery(opts.q, { compoundLogicalQuery: false }));
    }
    const items = await this.ctx.http.request<SalesOrder[]>({
      method: "GET",
      path: this.base(),
      query,
      auth,
    });
    return { items, pageNumber, pageSize, hasNextPage: items.length === pageSize };
  }

  /** Searches tenant sales-orders (`POST /salesorders/search`, body carries the `q` filter). */
  async search(
    query: SalesOrderSearchInput,
    auth: AuthContext,
    opts: { pageNumber?: number; pageSize?: number; sort?: string; fields?: string } = {},
  ): Promise<SalesOrder[]> {
    const q: Record<string, string | number | undefined> = {};
    setIfDefined(q, "pageNumber", opts.pageNumber);
    setIfDefined(q, "pageSize", opts.pageSize);
    setIfDefined(q, "sort", opts.sort);
    setIfDefined(q, "fields", opts.fields);
    return this.ctx.http.request<SalesOrder[]>({
      method: "POST",
      path: `${this.base()}/search`,
      ...(Object.keys(q).length > 0 ? { query: q } : {}),
      body: query,
      idempotent: true, // pure read over POST — safe to replay on 5xx/429
      auth,
    });
  }

  /** Creates a sales-order as an employee (`POST /salesorders`). Returns the created resource location. */
  async create(input: SalesOrderCreateInput, auth: AuthContext): Promise<SalesOrderCreated> {
    return this.ctx.http.request<SalesOrderCreated>({
      method: "POST",
      path: this.base(),
      auth,
      body: input,
    });
  }

  /**
   * Full-replaces a sales-order (`PUT /salesorders/{orderId}`, body `OrderUpdateDto`).
   * The endpoint returns 204, so the order is re-fetched (direct GET) and returned.
   * Note: `update` on this class is the PATCH (partial); `replace` is the PUT (full).
   */
  async replace(orderId: string, input: SalesOrderReplaceInput, auth: AuthContext): Promise<SalesOrder> {
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `${this.base()}/${orderId}`,
      auth,
      body: input,
    });
    return this.ctx.http.request<SalesOrder>({
      method: "GET",
      path: `${this.base()}/${orderId}`,
      auth,
    });
  }

  /** Deletes a sales-order (`DELETE /salesorders/{orderId}`). */
  async delete(orderId: string, auth: AuthContext): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/${orderId}`,
      auth,
    });
  }
```

- [ ] **Step 6: Add the barrel exports**

In `packages/sdk/src/orders.ts`, extend the `./services/orders` export block (lines 1-9) to include the new type aliases and option interfaces:

```ts
export {
  OrdersService,
  SalesOrdersService,
  type ListMyOrdersOptions,
  type GetOrderOptions,
  type OrderTransitionOptions,
  type UpdateSalesOrderOptions,
  type SalesOrderPatch,
  type SalesOrderCreateInput,
  type SalesOrderCreated,
  type SalesOrderReplaceInput,
  type SalesOrderSearchInput,
  type SalesOrderHistoricalTransitions,
  type SalesOrderCalculationInput,
  type SalesOrderEntriesInput,
  type SalesOrderSplitInput,
  type SalesOrderSplitResult,
  type ListSalesOrdersOptions,
  type ListLegalEntityOrdersOptions,
} from "./services/orders";
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk test -- orders-admin`
Expected: PASS (5 tests).

- [ ] **Step 8: Typecheck**

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add packages/sdk/src/services/orders.ts packages/sdk/src/orders.ts packages/sdk/tests/services/orders-admin.test.ts
git commit -m "feat(sdk): add salesorders admin list, search, create, replace, delete"
```

---

### Task 2: SalesOrders actions (transitions / historical / calculate / entries / split)

**Files:**
- Modify: `packages/sdk/src/services/orders.ts` (six methods appended to `SalesOrdersService`)
- Test: `packages/sdk/tests/services/orders-admin.test.ts` (append a describe block)

**Interfaces:**
- Consumes: aliases/types from Task 1, `Transition`, `SalesOrder`.
- Produces:
  - `listTransitions(orderId: string, auth: AuthContext): Promise<Transition[]>`
  - `transition(orderId: string, input: Transition, auth: AuthContext): Promise<void>`
  - `listHistoricalTransitions(orderId: string, auth: AuthContext): Promise<SalesOrderHistoricalTransitions>`
  - `calculate(orderId: string, input: SalesOrderCalculationInput, auth: AuthContext): Promise<unknown>`
  - `updateEntries(orderId: string, input: SalesOrderEntriesInput, auth: AuthContext): Promise<SalesOrder>`
  - `split(orderId: string, input: SalesOrderSplitInput, auth: AuthContext): Promise<SalesOrderSplitResult>`

- [ ] **Step 1: Write the failing test**

Append to `packages/sdk/tests/services/orders-admin.test.ts`:

```ts
describe("SalesOrdersService actions", () => {
  it("transition ops hit /salesorders/{id}/transitions and historical-transitions", async () => {
    const lt = vi.fn().mockResolvedValue([{ status: "COMPLETED" }]);
    await so(lt).listTransitions("o1", SVC);
    expect(lt).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: `${SB}/o1/transitions`, auth: SVC }));

    const t = vi.fn().mockResolvedValue(undefined);
    await so(t).transition("o1", { status: "COMPLETED" } as never, SVC);
    expect(t).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: `${SB}/o1/transitions`, body: { status: "COMPLETED" }, auth: SVC }));

    const h = vi.fn().mockResolvedValue({ transitions: [] });
    await so(h).listHistoricalTransitions("o1", SVC);
    expect(h).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: `${SB}/o1/historical-transitions`, auth: SVC }));
  });

  it("calculate / updateEntries / split POST the right paths", async () => {
    const c = vi.fn().mockResolvedValue({});
    await so(c).calculate("o1", {} as never, SVC);
    expect(c).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: `${SB}/o1/calculations`, body: {}, auth: SVC }));

    const e = vi.fn().mockResolvedValue({ id: "o1" });
    await so(e).updateEntries("o1", {} as never, SVC);
    expect(e).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: `${SB}/o1/entries`, body: {}, auth: SVC }));

    const s = vi.fn().mockResolvedValue({ orders: [] });
    await so(s).split("o1", {} as never, SVC);
    expect(s).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: `${SB}/o1/split`, body: {}, auth: SVC }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk test -- orders-admin`
Expected: FAIL — `listTransitions`/`transition`/… are not functions.

- [ ] **Step 3: Add the action methods**

Append inside the `SalesOrdersService` class, after `delete` (from Task 1) and before the class's closing brace:

```ts
  /** Lists the available transitions for a sales-order (`GET /salesorders/{orderId}/transitions`). */
  async listTransitions(orderId: string, auth: AuthContext): Promise<Transition[]> {
    return this.ctx.http.request<Transition[]>({
      method: "GET",
      path: `${this.base()}/${orderId}/transitions`,
      auth,
    });
  }

  /** Transitions a sales-order to a new status (`POST /salesorders/{orderId}/transitions`). */
  async transition(orderId: string, input: Transition, auth: AuthContext): Promise<void> {
    await this.ctx.http.request<void>({
      method: "POST",
      path: `${this.base()}/${orderId}/transitions`,
      auth,
      body: input,
    });
  }

  /** Lists the historical transitions of a sales-order (`GET /salesorders/{orderId}/historical-transitions`). */
  async listHistoricalTransitions(orderId: string, auth: AuthContext): Promise<SalesOrderHistoricalTransitions> {
    return this.ctx.http.request<SalesOrderHistoricalTransitions>({
      method: "GET",
      path: `${this.base()}/${orderId}/historical-transitions`,
      auth,
    });
  }

  /** Calculates order-entry totals for a sales-order (`POST /salesorders/{orderId}/calculations`). */
  async calculate(orderId: string, input: SalesOrderCalculationInput, auth: AuthContext): Promise<unknown> {
    return this.ctx.http.request<unknown>({
      method: "POST",
      path: `${this.base()}/${orderId}/calculations`,
      auth,
      body: input,
    });
  }

  /** Updates a sales-order's entries (`POST /salesorders/{orderId}/entries`). Returns the updated order. */
  async updateEntries(orderId: string, input: SalesOrderEntriesInput, auth: AuthContext): Promise<SalesOrder> {
    return this.ctx.http.request<SalesOrder>({
      method: "POST",
      path: `${this.base()}/${orderId}/entries`,
      auth,
      body: input,
    });
  }

  /** Splits a sales-order (`POST /salesorders/{orderId}/split`). */
  async split(orderId: string, input: SalesOrderSplitInput, auth: AuthContext): Promise<SalesOrderSplitResult> {
    return this.ctx.http.request<SalesOrderSplitResult>({
      method: "POST",
      path: `${this.base()}/${orderId}/split`,
      auth,
      body: input,
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk test -- orders-admin`
Expected: PASS (7 tests total).

- [ ] **Step 5: Typecheck**

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/services/orders.ts packages/sdk/tests/services/orders-admin.test.ts
git commit -m "feat(sdk): add salesorders transitions, calculations, entries, split"
```

---

### Task 3: OrdersService legal-entity B2B reads

**Files:**
- Modify: `packages/sdk/src/services/orders.ts` (two methods appended to `OrdersService`)
- Test: `packages/sdk/tests/services/orders-admin.test.ts` (append a describe block)

**Interfaces:**
- Consumes: existing `OrdersService(ctx)`, `saasHeader`, `setIfDefined`, `resolveQuery`, `PaginatedItems`, `SalesOrder`, `ListLegalEntityOrdersOptions`.
- Produces:
  - `listForLegalEntity(legalEntityId: string, auth: AuthContext, opts?: ListLegalEntityOrdersOptions): Promise<PaginatedItems<SalesOrder>>`
  - `getForLegalEntity(legalEntityId: string, orderId: string, auth: AuthContext, opts?: { saasToken?: string }): Promise<SalesOrder>`

- [ ] **Step 1: Write the failing test**

Append to `packages/sdk/tests/services/orders-admin.test.ts`:

```ts
describe("OrdersService legal-entity reads", () => {
  it("listForLegalEntity GETs /legal-entity-orders/{leId} wrapped into PaginatedItems", async () => {
    const l = vi.fn().mockResolvedValue([{ id: "o1" }]);
    const res = await os(l).listForLegalEntity("le1", CUST, { pageSize: 25 });
    expect(l).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: `${LEB}/le1`,
        auth: CUST,
        query: expect.objectContaining({ pageNumber: 1, pageSize: 25 }),
      }),
    );
    expect(res).toEqual({ items: [{ id: "o1" }], pageNumber: 1, pageSize: 25, hasNextPage: false });
  });

  it("getForLegalEntity GETs /legal-entity-orders/{leId}/{orderId}", async () => {
    const g = vi.fn().mockResolvedValue({ id: "o1" });
    await os(g).getForLegalEntity("le1", "o1", CUST);
    expect(g).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: `${LEB}/le1/o1`, auth: CUST }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk test -- orders-admin`
Expected: FAIL — `listForLegalEntity`/`getForLegalEntity` are not functions.

- [ ] **Step 3: Add the legal-entity methods**

Append inside the `OrdersService` class, after `cancel` (the last method) and before the class's closing brace:

```ts
  /**
   * Lists a legal entity's orders (`GET /legal-entity-orders/{legalEntityId}`),
   * wrapped into `PaginatedItems`. B2B storefront view — requires a customer
   * token with access to the legal entity.
   */
  async listForLegalEntity(
    legalEntityId: string,
    auth: AuthContext,
    opts: ListLegalEntityOrdersOptions = {},
  ): Promise<PaginatedItems<SalesOrder>> {
    const pageNumber = opts.pageNumber ?? 1;
    const pageSize = opts.pageSize ?? 50;
    const query: Record<string, string | number | undefined> = { pageNumber, pageSize };
    setIfDefined(query, "sort", opts.sort);
    if (opts.q !== undefined) {
      setIfDefined(query, "q", resolveQuery(opts.q, { compoundLogicalQuery: false }));
    }
    const headers = this.saasHeader(opts.saasToken);
    const items = await this.ctx.http.request<SalesOrder[]>({
      method: "GET",
      path: `/order-v2/${this.ctx.tenant}/legal-entity-orders/${legalEntityId}`,
      query,
      auth,
      ...(headers ? { headers } : {}),
    });
    return { items, pageNumber, pageSize, hasNextPage: items.length === pageSize };
  }

  /**
   * Fetches one order within a legal entity
   * (`GET /legal-entity-orders/{legalEntityId}/{orderId}`).
   */
  async getForLegalEntity(
    legalEntityId: string,
    orderId: string,
    auth: AuthContext,
    opts: { saasToken?: string } = {},
  ): Promise<SalesOrder> {
    const headers = this.saasHeader(opts.saasToken);
    return this.ctx.http.request<SalesOrder>({
      method: "GET",
      path: `/order-v2/${this.ctx.tenant}/legal-entity-orders/${legalEntityId}/${orderId}`,
      auth,
      ...(headers ? { headers } : {}),
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk test -- orders-admin`
Expected: PASS (9 tests total).

- [ ] **Step 5: Typecheck**

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/services/orders.ts packages/sdk/tests/services/orders-admin.test.ts
git commit -m "feat(sdk): add legal-entity order reads to orders service"
```

---

### Task 4: Changeset + full verification

**Files:**
- Create: `.changeset/order-v2-salesorders-legal-entity.md`

**Interfaces:**
- Consumes: nothing new.
- Produces: the release changeset; a green full test/typecheck/build run.

- [ ] **Step 1: Write the changeset**

Create `.changeset/order-v2-salesorders-legal-entity.md`:

```md
---
"@viu/emporix-sdk": minor
---

Complete the order-v2 admin surface. `client.salesOrders` gains `list`,
`search`, `create`, `replace` (PUT full-replace, alongside the existing `update`
PATCH), `delete`, `listTransitions`, `transition`, `listHistoricalTransitions`,
`calculate`, `updateEntries`, and `split`. `client.orders` gains the B2B reads
`listForLegalEntity` and `getForLegalEntity`. All sales-order admin methods take
a required (service-token) auth; the legal-entity reads take a required customer
auth. Existing order methods are unchanged.
```

- [ ] **Step 2: Run the full SDK unit suite**

Run: `pnpm -F @viu/emporix-sdk test`
Expected: PASS (existing suite + the new `orders-admin` tests).

- [ ] **Step 3: Repo-wide typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Build the SDK**

Run: `pnpm -F @viu/emporix-sdk build`
Expected: `dist/` written, no errors.

- [ ] **Step 5: Commit**

```bash
git add .changeset/order-v2-salesorders-legal-entity.md
git commit -m "chore(sdk): add changeset for order-v2 salesorders admin"
```

---

## Self-Review

**Spec coverage** — every in-scope spec operation maps to a task:

| Spec operation | Task |
|---|---|
| `list` (GET /salesorders) | 1 |
| `search` (POST /salesorders/search) | 1 |
| `create` (POST /salesorders) | 1 |
| `replace` (PUT /salesorders/{id}) | 1 |
| `delete` (DELETE /salesorders/{id}) | 1 |
| `listTransitions` (GET /salesorders/{id}/transitions) | 2 |
| `transition` (POST /salesorders/{id}/transitions) | 2 |
| `listHistoricalTransitions` (GET …/historical-transitions) | 2 |
| `calculate` (POST …/calculations) | 2 |
| `updateEntries` (POST …/entries) | 2 |
| `split` (POST …/split) | 2 |
| `listForLegalEntity` (GET /legal-entity-orders/{leId}) | 3 |
| `getForLegalEntity` (GET /legal-entity-orders/{leId}/{orderId}) | 3 |
| 9 type aliases + 2 option interfaces + barrel exports | 1 |
| Changeset (minor) | 4 |

Excluded (per spec): `RetrieveSpecificOrders` (artifact, response `unknown`), storefront `POST /orders` (checkout), storefront `/orders` transition-list. ✓

**Placeholder scan:** no TBD/TODO; every code step shows complete code. ✓

**Type consistency:** method names match between tests and implementations across all tasks (`list`/`search`/`create`/`replace`/`delete`/`listTransitions`/`transition`/`listHistoricalTransitions`/`calculate`/`updateEntries`/`split`/`listForLegalEntity`/`getForLegalEntity`). `auth` is a required positional arg on every new method. Generated import names verified against `src/generated/order-v2/types.gen.ts` (`SalesOrder`, `Transition`, `SalesOrderCreationDto`, `ResourceLocation`, `SearchRequest`, `HistoricalTransitionsResponse`, `OrderCalculationDto`, `OrderEntriesDto`, `OrderSplitRequest`, `OrderSplitResponse`, `OrderUpdateDto`). All new aliases/interfaces are defined and barrel-exported in Task 1 before Tasks 2/3 consume them. ✓

**Return-shape correctness:** `list`/`listForLegalEntity` wrap the bare `SalesOrder[]` into `PaginatedItems` (matching `listMine`); `search` returns the bare array; `create` returns `ResourceLocation`; `replace` re-fetches via a direct GET (204 has no body) and returns `SalesOrder`; `calculate` returns `unknown` (the generated 200 response). ✓
