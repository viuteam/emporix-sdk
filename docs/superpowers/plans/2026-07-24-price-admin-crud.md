# Price Admin CRUD Facade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `PriceService` (`client.prices`) with the full price **admin CRUD** — flat prices, price models, price lists, and nested price-list prices (28 methods) — leaving the existing `match*` methods untouched.

**Architecture:** Flat `/prices` CRUD as direct methods on `PriceService`; `priceModels` and `price-lists` as `readonly` sub-resource object literals (`client.prices.models`, `client.prices.lists`); nested price-list prices as methods on `lists` taking `listId` first. Every admin method defaults `authCtx: AuthContext = SERVICE` (override allowed), matching the existing `match*`. All bodies/reads alias generated `price` types. No wiring — `PriceService`/`client.prices`/channel `"price"` already exist.

**Tech Stack:** TypeScript, generated `price` types, Vitest with `vi.fn()`-mocked `http.request` (thin request-builder — no MSW/token-provider), `expectTypeOf`.

## Global Constraints

- Backward-compatible: only add methods/types; `match`, `matchByContext`, `matchByContextChunked` unchanged.
- Alias generated types from `src/generated/price/types.gen.ts`; never hand-author wire shapes.
- Every admin method ends with `authCtx: AuthContext = SERVICE` (the `SERVICE` const already exists in `price.ts`).
- List reads return plain arrays; bulk methods return `PriceBulkResult[]`.
- Paths are inline `/price/${this.ctx.tenant}/…` (the file has no `base()` helper).
- Commit scope `price`. Subject first word lowercase verb. Footer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Verify: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/price-admin.test.ts`; `pnpm -F @viu/emporix-sdk build`; `pnpm -r test`; `pnpm typecheck`.
- Test tenant `acme`. Harness = the `iam.test.ts` `ctxWith(vi.fn())` pattern (typed for `PriceService`).

## File Structure

- Modify `packages/sdk/src/services/price.ts` — add admin type aliases + flat methods + `models`/`lists` sub-resources.
- Modify `packages/sdk/src/index.ts` — export the new public types.
- Create `packages/sdk/tests/services/price-admin.test.ts` — vi-mock unit tests (kept separate from any existing price match tests).

---

## Task 1: Types + flat `/prices` CRUD

**Files:** Modify `price.ts`, `index.ts`; Create `tests/services/price-admin.test.ts`.

**Interfaces:**
- Produces public types (aliases) and `PriceService.{create,list,get,upsert,delete,search,bulkCreate,bulkUpsert}`.

- [ ] **Step 1: Write the failing test** (`tests/services/price-admin.test.ts`)

```ts
import { describe, it, expect, vi } from "vitest";
import { PriceService } from "../../src/services/price";

function ctxWith(request: ReturnType<typeof vi.fn>): ConstructorParameters<typeof PriceService>[0] {
  return {
    tenant: "acme",
    http: { request },
    tokenProvider: { getToken: vi.fn() },
    logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("PriceService flat prices admin", () => {
  it("create / list / get / upsert / delete / search / bulk hit the right method+path", async () => {
    const c = vi.fn().mockResolvedValue({ id: "p1" });
    await new PriceService(ctxWith(c)).create({} as never);
    expect(c).toHaveBeenCalledWith(expect.objectContaining({
      method: "POST", path: "/price/acme/prices", auth: { kind: "service" },
    }));

    const l = vi.fn().mockResolvedValue([{ id: "p1" }]);
    await new PriceService(ctxWith(l)).list();
    expect(l).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/price/acme/prices" }));

    const g = vi.fn().mockResolvedValue({ id: "p1" });
    await new PriceService(ctxWith(g)).get("p1");
    expect(g).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/price/acme/prices/p1" }));

    const u = vi.fn().mockResolvedValue({ id: "p1" });
    await new PriceService(ctxWith(u)).upsert("p1", {} as never);
    expect(u).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: "/price/acme/prices/p1" }));

    const d = vi.fn().mockResolvedValue(undefined);
    await new PriceService(ctxWith(d)).delete("p1");
    expect(d).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: "/price/acme/prices/p1" }));

    const s = vi.fn().mockResolvedValue([{ id: "p1" }]);
    await new PriceService(ctxWith(s)).search({});
    expect(s).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: "/price/acme/prices/search" }));

    const bc = vi.fn().mockResolvedValue([{ status: 201 }]);
    await new PriceService(ctxWith(bc)).bulkCreate([] as never);
    expect(bc).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: "/price/acme/prices/bulk" }));

    const bu = vi.fn().mockResolvedValue([{ status: 200 }]);
    await new PriceService(ctxWith(bu)).bulkUpsert([] as never);
    expect(bu).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: "/price/acme/prices/bulk" }));
  });

  it("honors an explicit auth override", async () => {
    const r = vi.fn().mockResolvedValue([]);
    await new PriceService(ctxWith(r)).list(undefined, { kind: "raw", token: "T" });
    expect(r).toHaveBeenCalledWith(expect.objectContaining({ auth: { kind: "raw", token: "T" } }));
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`create is not a function`)

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/price-admin.test.ts`

- [ ] **Step 3: Implement**

In `price.ts`, extend the `../generated/price` import and add the aliases (the two generated names that collide with public names are imported with a `Gen` prefix):

```ts
import type {
  Match,
  MatchByContext,
  MatchResponse,
  CreatePrice,
  GetPrice,
  PriceModelDefinitionCreation,
  PriceModelRetrieval,
  PriceListCreation,
  PriceListUpdate,
  PriceList as GenPriceList,
  PriceListPriceCreation,
  PriceListPriceUpdate,
  PriceListPrice as GenPriceListPrice,
  PriceBulkResponseEntry,
} from "../generated/price";
```

Add near the other exported types:

```ts
/** A resolved/stored price (generated read shape). */
export type Price = GetPrice;
/** Create/upsert body for a flat price (generated). */
export type PriceCreateInput = CreatePrice;
/** A price model (read). */
export type PriceModel = PriceModelRetrieval;
/** Create/upsert body for a price model (generated). */
export type PriceModelInput = PriceModelDefinitionCreation;
/** A price list (read). */
export type PriceList = GenPriceList;
/** Create body for a price list (generated). */
export type PriceListInput = PriceListCreation;
/** Upsert body for a price list (generated). */
export type PriceListUpdateInput = PriceListUpdate;
/** A price inside a price list (read). */
export type PriceListPrice = GenPriceListPrice;
/** Add body for a price-list price (generated). */
export type PriceListPriceInput = PriceListPriceCreation;
/** Upsert body for a price-list price (generated). */
export type PriceListPriceUpdateInput = PriceListPriceUpdate;
/** Per-entry result of a bulk price operation (generated). */
export type PriceBulkResult = PriceBulkResponseEntry;
```

Add the flat-price methods inside `PriceService` (after `matchByContextChunked`):

```ts
/** Creates a flat price. Default auth: service. */
async create(input: PriceCreateInput, authCtx: AuthContext = SERVICE): Promise<Price> {
  return this.ctx.http.request<Price>({
    method: "POST", path: `/price/${this.ctx.tenant}/prices`, auth: authCtx, body: input,
  });
}

/** Lists flat prices. Default auth: service. */
async list(query?: Record<string, string | number>, authCtx: AuthContext = SERVICE): Promise<Price[]> {
  return this.ctx.http.request<Price[]>({
    method: "GET", path: `/price/${this.ctx.tenant}/prices`, auth: authCtx, ...(query ? { query } : {}),
  });
}

/** Retrieves one flat price by id. Default auth: service. */
async get(priceId: string, authCtx: AuthContext = SERVICE): Promise<Price> {
  return this.ctx.http.request<Price>({
    method: "GET", path: `/price/${this.ctx.tenant}/prices/${priceId}`, auth: authCtx,
  });
}

/** Upserts a flat price by id (PUT). Default auth: service. */
async upsert(priceId: string, input: PriceCreateInput, authCtx: AuthContext = SERVICE): Promise<Price> {
  return this.ctx.http.request<Price>({
    method: "PUT", path: `/price/${this.ctx.tenant}/prices/${priceId}`, auth: authCtx, body: input,
  });
}

/** Deletes a flat price by id. Default auth: service. */
async delete(priceId: string, authCtx: AuthContext = SERVICE): Promise<void> {
  await this.ctx.http.request<void>({
    method: "DELETE", path: `/price/${this.ctx.tenant}/prices/${priceId}`, auth: authCtx,
  });
}

/** Searches flat prices (POST body query). Default auth: service. */
async search(query: Record<string, unknown>, authCtx: AuthContext = SERVICE): Promise<Price[]> {
  return this.ctx.http.request<Price[]>({
    method: "POST", path: `/price/${this.ctx.tenant}/prices/search`, auth: authCtx, body: query,
  });
}

/** Creates multiple flat prices in one request. Default auth: service. */
async bulkCreate(inputs: PriceCreateInput[], authCtx: AuthContext = SERVICE): Promise<PriceBulkResult[]> {
  return this.ctx.http.request<PriceBulkResult[]>({
    method: "POST", path: `/price/${this.ctx.tenant}/prices/bulk`, auth: authCtx, body: inputs,
  });
}

/** Upserts multiple flat prices in one request (PUT). Default auth: service. */
async bulkUpsert(inputs: PriceCreateInput[], authCtx: AuthContext = SERVICE): Promise<PriceBulkResult[]> {
  return this.ctx.http.request<PriceBulkResult[]>({
    method: "PUT", path: `/price/${this.ctx.tenant}/prices/bulk`, auth: authCtx, body: inputs,
  });
}
```

In `index.ts`, add the new public types to the price export block (find `export type { … } from "./services/price";`; if the price service currently only exports a class, add an `export type { … } from "./services/price";` line):

```ts
export type {
  Price,
  PriceCreateInput,
  PriceModel,
  PriceModelInput,
  PriceList,
  PriceListInput,
  PriceListUpdateInput,
  PriceListPrice,
  PriceListPriceInput,
  PriceListPriceUpdateInput,
  PriceBulkResult,
} from "./services/price";
```

> `PriceList` may already be re-exported elsewhere (e.g. a generated alias); if `index.ts` reports a duplicate export, keep the `./services/price` one and drop the other, or alias. Confirm at build.

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/price.ts packages/sdk/src/index.ts packages/sdk/tests/services/price-admin.test.ts
git commit -m "feat(price): add flat prices admin CRUD"
```

---

## Task 2: `client.prices.models` (price models)

**Files:** Modify `price.ts`; Test `tests/services/price-admin.test.ts`.
**Interfaces:** Produces `models.{list,create,get,upsert,delete}`.

- [ ] **Step 1: Failing test** — add to `price-admin.test.ts`:

```ts
describe("prices.models", () => {
  it("CRUD hits /priceModels", async () => {
    const l = vi.fn().mockResolvedValue([{ id: "m1" }]);
    await new PriceService(ctxWith(l)).models.list();
    expect(l).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/price/acme/priceModels", auth: { kind: "service" } }));

    const c = vi.fn().mockResolvedValue({ id: "m1" });
    await new PriceService(ctxWith(c)).models.create({} as never);
    expect(c).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: "/price/acme/priceModels" }));

    const g = vi.fn().mockResolvedValue({ id: "m1" });
    await new PriceService(ctxWith(g)).models.get("m1");
    expect(g).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/price/acme/priceModels/m1" }));

    const u = vi.fn().mockResolvedValue({ id: "m1" });
    await new PriceService(ctxWith(u)).models.upsert("m1", {} as never);
    expect(u).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: "/price/acme/priceModels/m1" }));

    const d = vi.fn().mockResolvedValue(undefined);
    await new PriceService(ctxWith(d)).models.delete("m1");
    expect(d).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: "/price/acme/priceModels/m1" }));
  });
});
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement** — add `readonly models` to `PriceService`:

```ts
readonly models = {
  list: async (query?: Record<string, string | number>, authCtx: AuthContext = SERVICE): Promise<PriceModel[]> =>
    this.ctx.http.request<PriceModel[]>({
      method: "GET", path: `/price/${this.ctx.tenant}/priceModels`, auth: authCtx, ...(query ? { query } : {}),
    }),
  create: async (input: PriceModelInput, authCtx: AuthContext = SERVICE): Promise<PriceModel> =>
    this.ctx.http.request<PriceModel>({
      method: "POST", path: `/price/${this.ctx.tenant}/priceModels`, auth: authCtx, body: input,
    }),
  get: async (modelId: string, authCtx: AuthContext = SERVICE): Promise<PriceModel> =>
    this.ctx.http.request<PriceModel>({
      method: "GET", path: `/price/${this.ctx.tenant}/priceModels/${modelId}`, auth: authCtx,
    }),
  upsert: async (modelId: string, input: PriceModelInput, authCtx: AuthContext = SERVICE): Promise<PriceModel> =>
    this.ctx.http.request<PriceModel>({
      method: "PUT", path: `/price/${this.ctx.tenant}/priceModels/${modelId}`, auth: authCtx, body: input,
    }),
  delete: async (modelId: string, authCtx: AuthContext = SERVICE): Promise<void> => {
    await this.ctx.http.request<void>({
      method: "DELETE", path: `/price/${this.ctx.tenant}/priceModels/${modelId}`, auth: authCtx,
    });
  },
};
```

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/price.ts packages/sdk/tests/services/price-admin.test.ts
git commit -m "feat(price): add prices.models CRUD"
```

---

## Task 3: `client.prices.lists` — price-list CRUD

**Files:** Modify `price.ts`; Test `tests/services/price-admin.test.ts`.
**Interfaces:** Produces `lists.{list,create,search,get,upsert,delete}` (nested price methods come in Task 4).

- [ ] **Step 1: Failing test** — add to `price-admin.test.ts`:

```ts
describe("prices.lists core", () => {
  it("CRUD + search hit /price-lists", async () => {
    const l = vi.fn().mockResolvedValue([{ id: "pl1" }]);
    await new PriceService(ctxWith(l)).lists.list();
    expect(l).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/price/acme/price-lists", auth: { kind: "service" } }));

    const c = vi.fn().mockResolvedValue({ id: "pl1" });
    await new PriceService(ctxWith(c)).lists.create({} as never);
    expect(c).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: "/price/acme/price-lists" }));

    const s = vi.fn().mockResolvedValue([{ id: "pl1" }]);
    await new PriceService(ctxWith(s)).lists.search({});
    expect(s).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: "/price/acme/price-lists/search" }));

    const g = vi.fn().mockResolvedValue({ id: "pl1" });
    await new PriceService(ctxWith(g)).lists.get("pl1");
    expect(g).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/price/acme/price-lists/pl1" }));

    const u = vi.fn().mockResolvedValue({ id: "pl1" });
    await new PriceService(ctxWith(u)).lists.upsert("pl1", {} as never);
    expect(u).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: "/price/acme/price-lists/pl1" }));

    const d = vi.fn().mockResolvedValue(undefined);
    await new PriceService(ctxWith(d)).lists.delete("pl1");
    expect(d).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: "/price/acme/price-lists/pl1" }));
  });
});
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement** — add `readonly lists` to `PriceService` with the six core methods (nested price methods are appended in Task 4):

```ts
readonly lists = {
  list: async (query?: Record<string, string | number>, authCtx: AuthContext = SERVICE): Promise<PriceList[]> =>
    this.ctx.http.request<PriceList[]>({
      method: "GET", path: `/price/${this.ctx.tenant}/price-lists`, auth: authCtx, ...(query ? { query } : {}),
    }),
  create: async (input: PriceListInput, authCtx: AuthContext = SERVICE): Promise<PriceList> =>
    this.ctx.http.request<PriceList>({
      method: "POST", path: `/price/${this.ctx.tenant}/price-lists`, auth: authCtx, body: input,
    }),
  search: async (query: Record<string, unknown>, authCtx: AuthContext = SERVICE): Promise<PriceList[]> =>
    this.ctx.http.request<PriceList[]>({
      method: "POST", path: `/price/${this.ctx.tenant}/price-lists/search`, auth: authCtx, body: query,
    }),
  get: async (listId: string, authCtx: AuthContext = SERVICE): Promise<PriceList> =>
    this.ctx.http.request<PriceList>({
      method: "GET", path: `/price/${this.ctx.tenant}/price-lists/${listId}`, auth: authCtx,
    }),
  upsert: async (listId: string, input: PriceListUpdateInput, authCtx: AuthContext = SERVICE): Promise<PriceList> =>
    this.ctx.http.request<PriceList>({
      method: "PUT", path: `/price/${this.ctx.tenant}/price-lists/${listId}`, auth: authCtx, body: input,
    }),
  delete: async (listId: string, authCtx: AuthContext = SERVICE): Promise<void> => {
    await this.ctx.http.request<void>({
      method: "DELETE", path: `/price/${this.ctx.tenant}/price-lists/${listId}`, auth: authCtx,
    });
  },
};
```

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/price.ts packages/sdk/tests/services/price-admin.test.ts
git commit -m "feat(price): add prices.lists CRUD"
```

---

## Task 4: `client.prices.lists` — nested price-list prices

**Files:** Modify `price.ts`; Test `tests/services/price-admin.test.ts`.
**Interfaces:** Adds to `lists`: `listPrices`, `addPrice`, `getPrice`, `upsertPrice`, `deletePrice`, `searchPrices`, `bulkCreatePrices`, `bulkUpsertPrices`, `bulkDeletePrices` (all take `listId` first).

- [ ] **Step 1: Failing test** — add to `price-admin.test.ts`:

```ts
describe("prices.lists nested prices", () => {
  it("single-price ops under /price-lists/{listId}/prices", async () => {
    const l = vi.fn().mockResolvedValue([{ id: "x" }]);
    await new PriceService(ctxWith(l)).lists.listPrices("pl1");
    expect(l).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/price/acme/price-lists/pl1/prices" }));

    const a = vi.fn().mockResolvedValue({ id: "x" });
    await new PriceService(ctxWith(a)).lists.addPrice("pl1", {} as never);
    expect(a).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: "/price/acme/price-lists/pl1/prices" }));

    const g = vi.fn().mockResolvedValue({ id: "x" });
    await new PriceService(ctxWith(g)).lists.getPrice("pl1", "x");
    expect(g).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/price/acme/price-lists/pl1/prices/x" }));

    const u = vi.fn().mockResolvedValue({ id: "x" });
    await new PriceService(ctxWith(u)).lists.upsertPrice("pl1", "x", {} as never);
    expect(u).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: "/price/acme/price-lists/pl1/prices/x" }));

    const d = vi.fn().mockResolvedValue(undefined);
    await new PriceService(ctxWith(d)).lists.deletePrice("pl1", "x");
    expect(d).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: "/price/acme/price-lists/pl1/prices/x" }));
  });

  it("search + bulk ops under /price-lists/{listId}/prices", async () => {
    const s = vi.fn().mockResolvedValue([{ id: "x" }]);
    await new PriceService(ctxWith(s)).lists.searchPrices("pl1", {});
    expect(s).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: "/price/acme/price-lists/pl1/prices/search" }));

    const bc = vi.fn().mockResolvedValue([{ status: 201 }]);
    await new PriceService(ctxWith(bc)).lists.bulkCreatePrices("pl1", [] as never);
    expect(bc).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: "/price/acme/price-lists/pl1/prices/bulk" }));

    const bu = vi.fn().mockResolvedValue([{ status: 200 }]);
    await new PriceService(ctxWith(bu)).lists.bulkUpsertPrices("pl1", [] as never);
    expect(bu).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: "/price/acme/price-lists/pl1/prices/bulk" }));

    const bd = vi.fn().mockResolvedValue([{ status: 204 }]);
    await new PriceService(ctxWith(bd)).lists.bulkDeletePrices("pl1", {} as never);
    expect(bd).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: "/price/acme/price-lists/pl1/prices/bulk" }));
  });
});
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement** — append these entries to the `readonly lists` object (after `delete`):

```ts
listPrices: async (listId: string, query?: Record<string, string | number>, authCtx: AuthContext = SERVICE): Promise<PriceListPrice[]> =>
  this.ctx.http.request<PriceListPrice[]>({
    method: "GET", path: `/price/${this.ctx.tenant}/price-lists/${listId}/prices`, auth: authCtx, ...(query ? { query } : {}),
  }),
addPrice: async (listId: string, input: PriceListPriceInput, authCtx: AuthContext = SERVICE): Promise<PriceListPrice> =>
  this.ctx.http.request<PriceListPrice>({
    method: "POST", path: `/price/${this.ctx.tenant}/price-lists/${listId}/prices`, auth: authCtx, body: input,
  }),
getPrice: async (listId: string, priceId: string, authCtx: AuthContext = SERVICE): Promise<PriceListPrice> =>
  this.ctx.http.request<PriceListPrice>({
    method: "GET", path: `/price/${this.ctx.tenant}/price-lists/${listId}/prices/${priceId}`, auth: authCtx,
  }),
upsertPrice: async (listId: string, priceId: string, input: PriceListPriceUpdateInput, authCtx: AuthContext = SERVICE): Promise<PriceListPrice> =>
  this.ctx.http.request<PriceListPrice>({
    method: "PUT", path: `/price/${this.ctx.tenant}/price-lists/${listId}/prices/${priceId}`, auth: authCtx, body: input,
  }),
deletePrice: async (listId: string, priceId: string, authCtx: AuthContext = SERVICE): Promise<void> => {
  await this.ctx.http.request<void>({
    method: "DELETE", path: `/price/${this.ctx.tenant}/price-lists/${listId}/prices/${priceId}`, auth: authCtx,
  });
},
searchPrices: async (listId: string, query: Record<string, unknown>, authCtx: AuthContext = SERVICE): Promise<PriceListPrice[]> =>
  this.ctx.http.request<PriceListPrice[]>({
    method: "POST", path: `/price/${this.ctx.tenant}/price-lists/${listId}/prices/search`, auth: authCtx, body: query,
  }),
bulkCreatePrices: async (listId: string, inputs: PriceListPriceInput[], authCtx: AuthContext = SERVICE): Promise<PriceBulkResult[]> =>
  this.ctx.http.request<PriceBulkResult[]>({
    method: "POST", path: `/price/${this.ctx.tenant}/price-lists/${listId}/prices/bulk`, auth: authCtx, body: inputs,
  }),
bulkUpsertPrices: async (listId: string, inputs: PriceListPriceInput[], authCtx: AuthContext = SERVICE): Promise<PriceBulkResult[]> =>
  this.ctx.http.request<PriceBulkResult[]>({
    method: "PUT", path: `/price/${this.ctx.tenant}/price-lists/${listId}/prices/bulk`, auth: authCtx, body: inputs,
  }),
bulkDeletePrices: async (listId: string, body: Record<string, unknown>, authCtx: AuthContext = SERVICE): Promise<PriceBulkResult[]> =>
  this.ctx.http.request<PriceBulkResult[]>({
    method: "DELETE", path: `/price/${this.ctx.tenant}/price-lists/${listId}/prices/bulk`, auth: authCtx, body,
  }),
```

> `bulkDeletePrices` sends a DELETE with a body (list of price ids/codes). Confirm the exact body shape against `generated/price` and tighten the `body` type at implementation.

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/price.ts packages/sdk/tests/services/price-admin.test.ts
git commit -m "feat(price): add nested price-list prices CRUD + bulk"
```

---

## Task 5: Finalize — verify, changeset, PR

**Files:** Create `.changeset/price-admin-crud.md`.

- [ ] **Step 1: Build + full test + typecheck**

Run: `pnpm -F @viu/emporix-sdk build && pnpm -r test && pnpm typecheck` — all green.

- [ ] **Step 2: Changeset**

Create `.changeset/price-admin-crud.md`:

```markdown
---
"@viu/emporix-sdk": minor
---

Add price admin CRUD to `client.prices`: flat prices
(`create`/`list`/`get`/`upsert`/`delete`/`search`/`bulkCreate`/`bulkUpsert`),
`prices.models` (price models CRUD), and `prices.lists` (price-list CRUD +
search + nested price-list prices incl. bulk). Every admin method defaults to
`service` auth (override allowed). The existing `match*` methods are unchanged.
```

- [ ] **Step 3: Commit**

```bash
git add .changeset/price-admin-crud.md
git commit -m "chore(price): add changeset for price admin crud"
```

- [ ] **Step 4: Push + PR** (base `main`, branch `feat/price-admin-crud`). PR body summarizes the flat/models/lists surfaces; ends with the Claude Code footer.

---

## Self-review checklist for the implementer

- Confirm each alias resolves at build. If a create/upsert response is an id-object or 204 rather than the entity, adjust the return type + test's mock together (runtime unaffected — the `request<T>` generic is a cast).
- Tighten the `search`/`bulkDeletePrices` body types from `Record<string, unknown>` to the generated request types if present.
- Ensure the existing `match`/`matchByContext`/`matchByContextChunked` are untouched.
- Watch for a duplicate `PriceList` export in `index.ts` (a generated alias may already be re-exported) — keep the `./services/price` one.
