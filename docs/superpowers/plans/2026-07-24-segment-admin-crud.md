# Customer-Segment Admin CRUD Facade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `SegmentService` (`client.segments`) with segment **admin CRUD** — segment entities, customer assignments, item assignments (25 methods) — leaving the storefront read methods untouched.

**Architecture:** Segment core CRUD as direct methods on `SegmentService`; `client.segments.customers` and `client.segments.items` as `readonly` sub-resource object literals. Every admin method defaults `authCtx: AuthContext = SERVICE` (override allowed). Bodies/reads alias generated `customer-segment` types. No wiring — `SegmentService`/`client.segments`/channel `"segment"` exist.

**Tech Stack:** TypeScript, generated `customer-segment` types, Vitest with `vi.fn()`-mocked `http.request`, `expectTypeOf`.

## Global Constraints

- Backward-compatible: only add methods/types; existing reads (`list`, `get`, `listItems`, `listSegmentItems`, `getCategoryTree`, `listMy*`) unchanged (they stay customer-auth).
- Alias generated types from `src/generated/customer-segment/types.gen.ts`; never hand-author wire shapes.
- Add a `SERVICE` const to `segment.ts` (`const SERVICE: AuthContext = { kind: "service" };`) — the file does not have one yet. Every admin method ends with `authCtx: AuthContext = SERVICE`.
- Paths use the existing `this.base()` = `/customer-segment/${tenant}/segments`.
- List/search reads return arrays; segment bulk → `SegmentBulkResult[]`; assignment bulk → `SegmentAssignmentBulkResult[]`.
- Commit scope `segment`. Subject first word lowercase verb. Footer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Verify: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/segment-admin.test.ts`; `pnpm -F @viu/emporix-sdk build`; `pnpm -r test`; `pnpm typecheck`.
- Test tenant `acme`. Harness constructs `new SegmentService(ctxWith(req), { products: {} as never, categories: {} as never })`.

## File Structure

- Modify `packages/sdk/src/services/segment.ts` — add `SERVICE` const, admin type aliases, core methods, `customers`/`items` sub-resources.
- Modify `packages/sdk/src/index.ts` — export new public types.
- Create `packages/sdk/tests/services/segment-admin.test.ts` — vi-mock unit tests.

---

## Task 1: Types + `SERVICE` const + segment core CRUD

**Files:** Modify `segment.ts`, `index.ts`; Create `tests/services/segment-admin.test.ts`.

**Interfaces:** Produces public aliases and `SegmentService.{create,search,update,patch,delete,match,bulkCreate,bulkUpdate,bulkDelete}`.

- [ ] **Step 1: Write the failing test** (`tests/services/segment-admin.test.ts`)

```ts
import { describe, it, expect, vi } from "vitest";
import { SegmentService } from "../../src/services/segment";

function ctxWith(request: ReturnType<typeof vi.fn>): ConstructorParameters<typeof SegmentService>[0] {
  return {
    tenant: "acme",
    http: { request },
    tokenProvider: { getToken: vi.fn() },
    logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const deps = { products: {} as any, categories: {} as any };
const svc = (req: ReturnType<typeof vi.fn>) => new SegmentService(ctxWith(req), deps);
const B = "/customer-segment/acme/segments";

describe("SegmentService segment core admin", () => {
  it("create/search/update/patch/delete/match/bulk hit the right method+path with SERVICE default", async () => {
    const c = vi.fn().mockResolvedValue({ id: "s1" });
    await svc(c).create({} as never);
    expect(c).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: B, auth: { kind: "service" } }));

    const s = vi.fn().mockResolvedValue([{ id: "s1" }]);
    await svc(s).search({} as never);
    expect(s).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: `${B}/search` }));

    const u = vi.fn().mockResolvedValue({ id: "s1" });
    await svc(u).update("s1", {} as never);
    expect(u).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: `${B}/s1` }));

    const p = vi.fn().mockResolvedValue({ id: "s1" });
    await svc(p).patch("s1", {} as never);
    expect(p).toHaveBeenCalledWith(expect.objectContaining({ method: "PATCH", path: `${B}/s1` }));

    const d = vi.fn().mockResolvedValue(undefined);
    await svc(d).delete("s1");
    expect(d).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: `${B}/s1` }));

    const m = vi.fn().mockResolvedValue([{ id: "s1" }]);
    await svc(m).match({} as never);
    expect(m).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: `${B}/match` }));

    const bc = vi.fn().mockResolvedValue([{ status: 201 }]);
    await svc(bc).bulkCreate([] as never);
    expect(bc).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: `${B}/bulk` }));

    const bu = vi.fn().mockResolvedValue([{ status: 200 }]);
    await svc(bu).bulkUpdate([] as never);
    expect(bu).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: `${B}/bulk` }));

    const bd = vi.fn().mockResolvedValue([{ status: 204 }]);
    await svc(bd).bulkDelete({} as never);
    expect(bd).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: `${B}/bulk` }));
  });

  it("honors an explicit auth override", async () => {
    const r = vi.fn().mockResolvedValue({ id: "s1" });
    await svc(r).create({} as never, { kind: "raw", token: "T" });
    expect(r).toHaveBeenCalledWith(expect.objectContaining({ auth: { kind: "raw", token: "T" } }));
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`create is not a function`)

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/segment-admin.test.ts`

- [ ] **Step 3: Implement**

In `segment.ts`, extend the `../generated/customer-segment` import with:

```ts
  SegmentCreation,
  SegmentUpdate,
  SegmentsSearch,
  SegmentUpdateBulk,
  Match,
  CustomerAssignmentUpsert,
  CustomerAssignmentUpsertBulk,
  CustomerAssignmentResponse,
  ItemAssignmentUpsert,
  ItemAssignmentUpsertBulk,
  BulkResponse,
  BulkAssignmentResponse,
```

(kept alongside the existing `SegmentResponse, ItemAssignmentResponse, CategoryTreeResponse`.)

Add a `SERVICE` const near the top of the module (after the imports):

```ts
const SERVICE: AuthContext = { kind: "service" };
```

Add the admin type aliases (near the existing `export type Segment = …`):

```ts
/** Create body for a segment (generated). */
export type SegmentInput = SegmentCreation;
/** Full-replace (PUT) body for a segment (generated). */
export type SegmentUpdateInput = SegmentUpdate;
/** Partial (PATCH) body for a segment. */
export type SegmentPatchInput = Partial<SegmentUpdate>;
/** Search body for segments (generated). */
export type SegmentSearchQuery = SegmentsSearch;
/** Body for a segment match check (generated). */
export type SegmentMatchInput = Match;
/** One entry of a segment bulk request (generated). */
export type SegmentBulkItem = SegmentUpdateBulk;
/** Per-entry result of a segment bulk operation (generated). */
export type SegmentBulkResult = BulkResponse;
/** Customer→segment assignment body (generated). */
export type SegmentCustomerInput = CustomerAssignmentUpsert;
/** One entry of a customer-assignment bulk request (generated). */
export type SegmentCustomerBulkInput = CustomerAssignmentUpsertBulk;
/** A customer→segment assignment (read). */
export type SegmentCustomer = CustomerAssignmentResponse;
/** Item→segment assignment body (generated). */
export type SegmentItemInput = ItemAssignmentUpsert;
/** One entry of an item-assignment bulk request (generated). */
export type SegmentItemBulkInput = ItemAssignmentUpsertBulk;
/** Per-entry result of an assignment bulk operation (generated). */
export type SegmentAssignmentBulkResult = BulkAssignmentResponse;
```

Add the core methods inside `SegmentService` (after the existing read methods):

```ts
/** Creates a segment. Default auth: service. */
async create(input: SegmentInput, authCtx: AuthContext = SERVICE): Promise<Segment> {
  return this.ctx.http.request<Segment>({ method: "POST", path: this.base(), auth: authCtx, body: input });
}

/** Searches segments (POST body). Default auth: service. */
async search(query: SegmentSearchQuery, authCtx: AuthContext = SERVICE): Promise<Segment[]> {
  return this.ctx.http.request<Segment[]>({ method: "POST", path: `${this.base()}/search`, auth: authCtx, body: query });
}

/** Full-replaces a segment (PUT). Default auth: service. */
async update(segmentId: string, input: SegmentUpdateInput, authCtx: AuthContext = SERVICE): Promise<Segment> {
  return this.ctx.http.request<Segment>({ method: "PUT", path: `${this.base()}/${segmentId}`, auth: authCtx, body: input });
}

/** Partially updates a segment (PATCH). Default auth: service. */
async patch(segmentId: string, input: SegmentPatchInput, authCtx: AuthContext = SERVICE): Promise<Segment> {
  return this.ctx.http.request<Segment>({ method: "PATCH", path: `${this.base()}/${segmentId}`, auth: authCtx, body: input });
}

/** Deletes a segment. Default auth: service. */
async delete(segmentId: string, authCtx: AuthContext = SERVICE): Promise<void> {
  await this.ctx.http.request<void>({ method: "DELETE", path: `${this.base()}/${segmentId}`, auth: authCtx });
}

/** Checks which segments the given items/customers match. Default auth: service. */
async match(input: SegmentMatchInput, authCtx: AuthContext = SERVICE): Promise<Segment[]> {
  return this.ctx.http.request<Segment[]>({ method: "POST", path: `${this.base()}/match`, auth: authCtx, body: input });
}

/** Creates multiple segments. Default auth: service. */
async bulkCreate(inputs: SegmentBulkItem[], authCtx: AuthContext = SERVICE): Promise<SegmentBulkResult[]> {
  return this.ctx.http.request<SegmentBulkResult[]>({ method: "POST", path: `${this.base()}/bulk`, auth: authCtx, body: inputs });
}

/** Upserts multiple segments (PUT). Default auth: service. */
async bulkUpdate(inputs: SegmentBulkItem[], authCtx: AuthContext = SERVICE): Promise<SegmentBulkResult[]> {
  return this.ctx.http.request<SegmentBulkResult[]>({ method: "PUT", path: `${this.base()}/bulk`, auth: authCtx, body: inputs });
}

/** Deletes multiple segments (DELETE with body of ids). Default auth: service. */
async bulkDelete(body: Record<string, unknown>, authCtx: AuthContext = SERVICE): Promise<SegmentBulkResult[]> {
  return this.ctx.http.request<SegmentBulkResult[]>({ method: "DELETE", path: `${this.base()}/bulk`, auth: authCtx, body });
}
```

In `index.ts`, add to the segment type export block (find `… from "./services/segment";`): `SegmentInput, SegmentUpdateInput, SegmentPatchInput, SegmentSearchQuery, SegmentMatchInput, SegmentBulkItem, SegmentBulkResult, SegmentCustomerInput, SegmentCustomerBulkInput, SegmentCustomer, SegmentItemInput, SegmentItemBulkInput, SegmentAssignmentBulkResult`.

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/segment.ts packages/sdk/src/index.ts packages/sdk/tests/services/segment-admin.test.ts
git commit -m "feat(segment): add segment core admin CRUD"
```

---

## Task 2: `client.segments.customers`

**Files:** Modify `segment.ts`; Test `tests/services/segment-admin.test.ts`.
**Interfaces:** Produces `customers.{list,search,get,assign,remove,getForEntity,assignForEntity,removeForEntity,bulkAssign,bulkRemove}`.

- [ ] **Step 1: Failing test** — add to `segment-admin.test.ts`:

```ts
describe("segments.customers", () => {
  it("B2C + B2B + bulk hit the right method+path", async () => {
    const l = vi.fn().mockResolvedValue([{ id: "c1" }]);
    await svc(l).customers.list("s1");
    expect(l).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: `${B}/s1/customers`, auth: { kind: "service" } }));

    const se = vi.fn().mockResolvedValue([{ id: "c1" }]);
    await svc(se).customers.search("s1", {});
    expect(se).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: `${B}/s1/customers/search` }));

    const g = vi.fn().mockResolvedValue({ id: "c1" });
    await svc(g).customers.get("s1", "c1");
    expect(g).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: `${B}/s1/customers/c1` }));

    const a = vi.fn().mockResolvedValue({ id: "c1" });
    await svc(a).customers.assign("s1", "c1", {} as never);
    expect(a).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: `${B}/s1/customers/c1` }));

    const r = vi.fn().mockResolvedValue(undefined);
    await svc(r).customers.remove("s1", "c1");
    expect(r).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: `${B}/s1/customers/c1` }));

    const ge = vi.fn().mockResolvedValue({ id: "c1" });
    await svc(ge).customers.getForEntity("s1", "c1", "le1");
    expect(ge).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: `${B}/s1/customers/c1/le1` }));

    const ae = vi.fn().mockResolvedValue({ id: "c1" });
    await svc(ae).customers.assignForEntity("s1", "c1", "le1", {} as never);
    expect(ae).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: `${B}/s1/customers/c1/le1` }));

    const re = vi.fn().mockResolvedValue(undefined);
    await svc(re).customers.removeForEntity("s1", "c1", "le1");
    expect(re).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: `${B}/s1/customers/c1/le1` }));

    const ba = vi.fn().mockResolvedValue([{ status: 200 }]);
    await svc(ba).customers.bulkAssign("s1", [] as never);
    expect(ba).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: `${B}/s1/customers/bulk` }));

    const br = vi.fn().mockResolvedValue([{ status: 204 }]);
    await svc(br).customers.bulkRemove("s1", {} as never);
    expect(br).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: `${B}/s1/customers/bulk` }));
  });
});
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement** — add `readonly customers` to `SegmentService`:

```ts
readonly customers = {
  list: async (segmentId: string, query?: Record<string, string | number>, authCtx: AuthContext = SERVICE): Promise<SegmentCustomer[]> =>
    this.ctx.http.request<SegmentCustomer[]>({ method: "GET", path: `${this.base()}/${segmentId}/customers`, auth: authCtx, ...(query ? { query } : {}) }),
  search: async (segmentId: string, query: Record<string, unknown>, authCtx: AuthContext = SERVICE): Promise<SegmentCustomer[]> =>
    this.ctx.http.request<SegmentCustomer[]>({ method: "POST", path: `${this.base()}/${segmentId}/customers/search`, auth: authCtx, body: query }),
  get: async (segmentId: string, customerId: string, authCtx: AuthContext = SERVICE): Promise<SegmentCustomer> =>
    this.ctx.http.request<SegmentCustomer>({ method: "GET", path: `${this.base()}/${segmentId}/customers/${customerId}`, auth: authCtx }),
  assign: async (segmentId: string, customerId: string, input: SegmentCustomerInput, authCtx: AuthContext = SERVICE): Promise<SegmentCustomer> =>
    this.ctx.http.request<SegmentCustomer>({ method: "PUT", path: `${this.base()}/${segmentId}/customers/${customerId}`, auth: authCtx, body: input }),
  remove: async (segmentId: string, customerId: string, authCtx: AuthContext = SERVICE): Promise<void> => {
    await this.ctx.http.request<void>({ method: "DELETE", path: `${this.base()}/${segmentId}/customers/${customerId}`, auth: authCtx });
  },
  getForEntity: async (segmentId: string, customerId: string, legalEntityId: string, authCtx: AuthContext = SERVICE): Promise<SegmentCustomer> =>
    this.ctx.http.request<SegmentCustomer>({ method: "GET", path: `${this.base()}/${segmentId}/customers/${customerId}/${legalEntityId}`, auth: authCtx }),
  assignForEntity: async (segmentId: string, customerId: string, legalEntityId: string, input: SegmentCustomerInput, authCtx: AuthContext = SERVICE): Promise<SegmentCustomer> =>
    this.ctx.http.request<SegmentCustomer>({ method: "PUT", path: `${this.base()}/${segmentId}/customers/${customerId}/${legalEntityId}`, auth: authCtx, body: input }),
  removeForEntity: async (segmentId: string, customerId: string, legalEntityId: string, authCtx: AuthContext = SERVICE): Promise<void> => {
    await this.ctx.http.request<void>({ method: "DELETE", path: `${this.base()}/${segmentId}/customers/${customerId}/${legalEntityId}`, auth: authCtx });
  },
  bulkAssign: async (segmentId: string, inputs: SegmentCustomerBulkInput[], authCtx: AuthContext = SERVICE): Promise<SegmentAssignmentBulkResult[]> =>
    this.ctx.http.request<SegmentAssignmentBulkResult[]>({ method: "PUT", path: `${this.base()}/${segmentId}/customers/bulk`, auth: authCtx, body: inputs }),
  bulkRemove: async (segmentId: string, body: Record<string, unknown>, authCtx: AuthContext = SERVICE): Promise<SegmentAssignmentBulkResult[]> =>
    this.ctx.http.request<SegmentAssignmentBulkResult[]>({ method: "DELETE", path: `${this.base()}/${segmentId}/customers/bulk`, auth: authCtx, body }),
};
```

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/segment.ts packages/sdk/tests/services/segment-admin.test.ts
git commit -m "feat(segment): add segments.customers assignment CRUD"
```

---

## Task 3: `client.segments.items`

**Files:** Modify `segment.ts`; Test `tests/services/segment-admin.test.ts`.
**Interfaces:** Produces `items.{search,get,assign,remove,bulkAssign,bulkRemove}` (`type` = `PRODUCT`|`CATEGORY`).

- [ ] **Step 1: Failing test** — add to `segment-admin.test.ts`:

```ts
describe("segments.items", () => {
  it("assignment ops hit /items/{type}...", async () => {
    const s = vi.fn().mockResolvedValue([{ id: "i1" }]);
    await svc(s).items.search("s1", {});
    expect(s).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: `${B}/s1/items/search`, auth: { kind: "service" } }));

    const g = vi.fn().mockResolvedValue({ id: "i1" });
    await svc(g).items.get("s1", "PRODUCT", "p1");
    expect(g).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: `${B}/s1/items/PRODUCT/p1` }));

    const a = vi.fn().mockResolvedValue({ id: "i1" });
    await svc(a).items.assign("s1", "PRODUCT", "p1", {} as never);
    expect(a).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: `${B}/s1/items/PRODUCT/p1` }));

    const r = vi.fn().mockResolvedValue(undefined);
    await svc(r).items.remove("s1", "PRODUCT", "p1");
    expect(r).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: `${B}/s1/items/PRODUCT/p1` }));

    const ba = vi.fn().mockResolvedValue([{ status: 200 }]);
    await svc(ba).items.bulkAssign("s1", "PRODUCT", [] as never);
    expect(ba).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: `${B}/s1/items/PRODUCT/bulk` }));

    const br = vi.fn().mockResolvedValue([{ status: 204 }]);
    await svc(br).items.bulkRemove("s1", "PRODUCT", {} as never);
    expect(br).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: `${B}/s1/items/PRODUCT/bulk` }));
  });
});
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement** — add `readonly items` to `SegmentService`:

```ts
readonly items = {
  search: async (segmentId: string, query: Record<string, unknown>, authCtx: AuthContext = SERVICE): Promise<SegmentItem[]> =>
    this.ctx.http.request<SegmentItem[]>({ method: "POST", path: `${this.base()}/${segmentId}/items/search`, auth: authCtx, body: query }),
  get: async (segmentId: string, type: string, itemId: string, authCtx: AuthContext = SERVICE): Promise<SegmentItem> =>
    this.ctx.http.request<SegmentItem>({ method: "GET", path: `${this.base()}/${segmentId}/items/${type}/${itemId}`, auth: authCtx }),
  assign: async (segmentId: string, type: string, itemId: string, input: SegmentItemInput, authCtx: AuthContext = SERVICE): Promise<SegmentItem> =>
    this.ctx.http.request<SegmentItem>({ method: "PUT", path: `${this.base()}/${segmentId}/items/${type}/${itemId}`, auth: authCtx, body: input }),
  remove: async (segmentId: string, type: string, itemId: string, authCtx: AuthContext = SERVICE): Promise<void> => {
    await this.ctx.http.request<void>({ method: "DELETE", path: `${this.base()}/${segmentId}/items/${type}/${itemId}`, auth: authCtx });
  },
  bulkAssign: async (segmentId: string, type: string, inputs: SegmentItemBulkInput[], authCtx: AuthContext = SERVICE): Promise<SegmentAssignmentBulkResult[]> =>
    this.ctx.http.request<SegmentAssignmentBulkResult[]>({ method: "PUT", path: `${this.base()}/${segmentId}/items/${type}/bulk`, auth: authCtx, body: inputs }),
  bulkRemove: async (segmentId: string, type: string, body: Record<string, unknown>, authCtx: AuthContext = SERVICE): Promise<SegmentAssignmentBulkResult[]> =>
    this.ctx.http.request<SegmentAssignmentBulkResult[]>({ method: "DELETE", path: `${this.base()}/${segmentId}/items/${type}/bulk`, auth: authCtx, body }),
};
```

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/segment.ts packages/sdk/tests/services/segment-admin.test.ts
git commit -m "feat(segment): add segments.items assignment CRUD"
```

---

## Task 4: Finalize — verify, changeset, PR

**Files:** Create `.changeset/segment-admin-crud.md`.

- [ ] **Step 1: Build + full test + typecheck**

Run: `pnpm -F @viu/emporix-sdk build && pnpm -r test && pnpm typecheck` — all green.

- [ ] **Step 2: Changeset**

Create `.changeset/segment-admin-crud.md`:

```markdown
---
"@viu/emporix-sdk": minor
---

Add customer-segment admin CRUD to `client.segments`: segment core
(`create`/`search`/`update`/`patch`/`delete`/`match` + `bulkCreate`/`bulkUpdate`/`bulkDelete`),
`segments.customers` (list/search + B2C & B2B assign/remove + bulk), and
`segments.items` (search + assign/remove per PRODUCT/CATEGORY + bulk). Every
admin method defaults to `service` auth (override allowed). The existing
storefront read methods are unchanged.
```

- [ ] **Step 3: Commit**

```bash
git add .changeset/segment-admin-crud.md
git commit -m "chore(segment): add changeset for segment admin crud"
```

- [ ] **Step 4: Push + PR** (base `main`, branch `feat/segment-admin-crud`). PR body summarizes the core/customers/items surfaces; ends with the Claude Code footer.

---

## Self-review checklist for the implementer

- Confirm each alias resolves at build. If a create/assign response is an id-object or 204 rather than the entity, adjust the return type + the test mock together (runtime unaffected — the `request<T>` generic is a cast).
- Tighten `search`/bulk-delete body types from `Record<string, unknown>`/`SegmentPatchInput` to the generated request/patch types if present.
- Ensure the existing read methods (`list`/`get`/`listItems`/`listSegmentItems`/`getCategoryTree`/`listMy*`) are untouched and still customer-auth.
- The new admin methods use `this.ctx` only (no `this.deps`), so they work regardless of hydrate deps.
