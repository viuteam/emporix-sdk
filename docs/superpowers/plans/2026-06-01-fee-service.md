# Fee Service Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bindings for the Emporix Fee Service as a single server-side core SDK service, `client.fees`, covering fee definitions (`/fees` CRUD), item-fee mappings (`/itemFees`), and product-fee mappings (`/productFees`).

**Architecture:** Types are generated from the upstream OpenAPI via the existing `@hey-api/openapi-ts` pipeline; a thin public-types module re-exports them under stable SDK names. One service class (`FeeService`) mirrors the three API groups via name-prefixed methods, defaulting to the service (clientCredentials) token like `price`/`media`/`tenant-config`. It is wired onto `EmporixClient` exactly like the other services.

**Tech Stack:** TypeScript, Vitest + MSW (Node), `@hey-api/openapi-ts`, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-06-01-fee-service-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/sdk/scripts/fetch-specs.ts` | add the `fee` spec URL to the fetch list |
| `packages/sdk/specs/fee.yml` | fetched OpenAPI (committed artifact) |
| `packages/sdk/src/generated/fee/{index.ts,types.gen.ts}` | generated types (committed artifact) |
| `packages/sdk/src/services/fee-types.ts` | public types: `Fee`, `ItemFee`, `FeeDraft`, `ItemFeeDraft`, `ItemFeeSearch`, `ListFeesQuery`, `SetItemFeesOptions` |
| `packages/sdk/src/services/fee.ts` | `FeeService` (fees CRUD + itemFees + productFees) |
| `packages/sdk/src/fee.ts` | one-line facade re-export |
| `packages/sdk/src/core/logger.ts` | add `"fee"` to the `ServiceName` union |
| `packages/sdk/src/client.ts` | construct + expose `fees` |
| `packages/sdk/src/index.ts` | re-export the facade |
| `packages/sdk/tests/services/fee-types.test.ts` | type-level tests |
| `packages/sdk/tests/services/fee.test.ts` | MSW tests |
| `packages/sdk/tests/services/fee-wiring.test.ts` | client wiring test |
| `docs/fee.md` | usage doc |
| `CLAUDE.md` | service-list update |
| `.changeset/fee-service.md` | release entry |

All commands run from the repo root: `/Users/dominic.fritschi/projects/viu/emporix-sdk`.

---

## Task 1: Generate Fee types (codegen)

**Files:**
- Modify: `packages/sdk/scripts/fetch-specs.ts`
- Create (generated): `packages/sdk/specs/fee.yml`, `packages/sdk/src/generated/fee/index.ts`, `packages/sdk/src/generated/fee/types.gen.ts`

- [ ] **Step 1: Add the spec entry**

In `packages/sdk/scripts/fetch-specs.ts`, add this line to the `SPECS` object (after the `configuration` entry):

```ts
  fee: `${BASE}/checkout/fee/api-reference/api.yml`,
```

(URL verified live → HTTP 200:
`https://raw.githubusercontent.com/emporix/api-references/refs/heads/main/checkout/fee/api-reference/api.yml`.)

- [ ] **Step 2: Fetch + generate**

Run:
```bash
pnpm -F @viu/emporix-sdk fetch:specs
pnpm -F @viu/emporix-sdk generate
```
Expected: console prints `fetched fee (...bytes)` and the generate step exits 0, writing `packages/sdk/src/generated/fee/{index.ts,types.gen.ts}`.

- [ ] **Step 3: Discover the generated type names**

The public-types module (Task 2) and the service (Task 3) depend on the names hey-api emitted for the **fee response**, the **item-fee response**, and their **create/update bodies**. Discover them:

```bash
grep -nE "export type (Fee|ItemFee|FeeDraft|FeeCreate|FeeUpdate|ItemFeeDraft|ItemFeeCreate|CreateFee|UpdateFee|FeeRequest|FeesItem)\b" packages/sdk/src/generated/fee/types.gen.ts
grep -nE "^export type " packages/sdk/src/generated/fee/types.gen.ts | head -60
```
Expected: at least one type that carries `code`, `feeType`, `siteCode`, `active` (the fee), and one with `itemYrn` + `feeIds` (the item fee). **Record the actual emitted names** — Task 2's imports must match them. Common hey-api outputs are `Fee`, `ItemFee`, plus request-body names like `FeeRequest` / `CreateFeeData` / a `*Body` suffix. If create and update share one body schema, a single `FeeDraft` alias covers both.

**Fallback (if no usable draft/body type was emitted):** hand-write `FeeDraft` / `ItemFeeDraft` as interfaces in Task 2 (the spec sanctions this — public types may be hand-written). The shapes are fully specified in the design doc §1 (`Fee` shape minus `id`/`yrn`; `ItemFee` shape minus `id`). Note which path you took for Task 2, Step 3.

- [ ] **Step 4: Keep the change focused**

Run `git status --short`. If `fetch:specs`/`generate` also touched other `specs/*.yml` or `src/generated/*` files (upstream drift unrelated to this feature), restore them so this PR stays scoped:
```bash
git restore packages/sdk/specs packages/sdk/src/generated
git restore --staged packages/sdk/specs packages/sdk/src/generated 2>/dev/null || true
```
Then re-run Step 2 and immediately stage just the `fee` paths in Step 5. (If `git status` showed only the new `fee` files, skip this step.)

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/scripts/fetch-specs.ts packages/sdk/specs/fee.yml packages/sdk/src/generated/fee
git commit -m "feat(sdk): generate fee service types"
```

---

## Task 2: Public types module

**Files:**
- Create: `packages/sdk/src/services/fee-types.ts`
- Test: `packages/sdk/tests/services/fee-types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/fee-types.test.ts`:

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  Fee,
  ItemFee,
  FeeDraft,
  ItemFeeDraft,
  ItemFeeSearch,
  ListFeesQuery,
  SetItemFeesOptions,
} from "../../src/services/fee-types";

describe("fee types", () => {
  it("Fee carries the core fee fields", () => {
    const f: Fee = {
      id: "fee_1",
      name: { en: "Small order fee" },
      code: "small-order",
      feeType: "PERCENT",
      feePercentage: 2.5,
      siteCode: "main",
      active: true,
      yrn: "urn:yaas:...:fee:fee_1",
    };
    expectTypeOf(f.code).toEqualTypeOf<string>();
    expectTypeOf(f.feeType).toEqualTypeOf<"PERCENT" | "ABSOLUTE" | "ABSOLUTE_MULTIPLY_ITEMQUANTITY">();
  });

  it("ItemFee carries itemYrn + feeIds + siteCode", () => {
    const i: ItemFee = { id: "if_1", itemYrn: "urn:...:product:p1", feeIds: ["fee_1"], siteCode: "main" };
    expectTypeOf(i.itemYrn).toEqualTypeOf<string>();
    expectTypeOf(i.feeIds).toEqualTypeOf<string[]>();
  });

  it("FeeDraft omits server-managed id/yrn", () => {
    const d: FeeDraft = {
      name: { en: "Fee" },
      code: "fee",
      feeType: "ABSOLUTE",
      feeAbsolute: { amount: 5, currency: "CHF" },
      siteCode: "main",
      active: true,
    };
    expectTypeOf(d).not.toHaveProperty("id");
    expectTypeOf(d).not.toHaveProperty("yrn");
  });

  it("ItemFeeDraft has the create body shape", () => {
    const d: ItemFeeDraft = { itemYrn: "urn:...:product:p1", feeIds: ["fee_1"], siteCode: "main" };
    expectTypeOf(d.feeIds).toEqualTypeOf<string[]>();
  });

  it("ItemFeeSearch is itemYrns + siteCode", () => {
    const s: ItemFeeSearch = { itemYrns: ["a", "b"], siteCode: "main" };
    expectTypeOf(s.itemYrns).toEqualTypeOf<string[]>();
  });

  it("ListFeesQuery has page params and an open index signature", () => {
    const q: ListFeesQuery = { pageNumber: 1, pageSize: 60, q: "code:small-order" };
    expectTypeOf(q.pageNumber).toEqualTypeOf<number | undefined>();
  });

  it("SetItemFeesOptions.partial is boolean", () => {
    const o: SetItemFeesOptions = { partial: true };
    expectTypeOf(o.partial).toEqualTypeOf<boolean | undefined>();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/fee-types.test.ts`
Expected: FAIL — cannot find module `../../src/services/fee-types`.

- [ ] **Step 3: Write the types module**

Create `packages/sdk/src/services/fee-types.ts`. **Replace `GenFee` / `GenItemFee` / the draft imports with the actual names recorded in Task 1, Step 3.** If no usable draft type was generated, use the hand-written-interface fallback shown below (uncomment the `interface` blocks and drop the `FeeDraft` / `ItemFeeDraft` aliases):

```ts
import type {
  // Rename these to the names hey-api emitted (Task 1, Step 3).
  Fee as GenFee,
  ItemFee as GenItemFee,
} from "../generated/fee";

/** A fee definition as returned by the API (`id`/`yrn` server-assigned). */
export type Fee = GenFee;

/** An item-fee (or product-fee) mapping as returned by the API. */
export type ItemFee = GenItemFee;

/**
 * Body for create/update of a fee definition. Mirrors {@link Fee} minus the
 * server-assigned `id`/`yrn`. Aliased to the generated request body if one was
 * emitted; otherwise hand-written here.
 */
export type FeeDraft = Omit<Fee, "id" | "yrn">;

/** Body for `POST /itemFees`. Mirrors {@link ItemFee} minus the server `id`. */
export type ItemFeeDraft = Omit<ItemFee, "id">;

// --- Fallback (use only if Task 1 emitted no usable Fee/ItemFee types) ---
// export interface FeeDraft {
//   name: { [locale: string]: string };
//   description?: { [locale: string]: string };
//   code: string;
//   feeType: "PERCENT" | "ABSOLUTE" | "ABSOLUTE_MULTIPLY_ITEMQUANTITY";
//   feePercentage?: number;
//   feeAbsolute?: { amount: number; currency: string };
//   itemType?: "PRODUCT" | "PAYMENTTYPE";
//   siteCode: string;
//   active: boolean;
//   taxable?: boolean;
//   taxCode?: string;
//   activeTimespan?: { startDate: string; endDate: string };
// }
// export interface ItemFeeDraft {
//   itemYrn: string;
//   feeIds: string[];
//   siteCode: string;
// }

/** Body of `POST /itemFees/search`. */
export interface ItemFeeSearch {
  itemYrns: string[];
  siteCode: string;
}

/**
 * Query for the paginated `GET /fees` list. Explicit fields are typed for
 * autocomplete; the index signature stays open so Emporix `q`-syntax filters
 * pass through verbatim (mirrors `ListAssetsQuery` in `media`).
 */
export interface ListFeesQuery {
  pageNumber?: number;
  pageSize?: number;
  /** Emporix sort syntax, e.g. `"code:asc"`. */
  sort?: string;
  /** Emporix `q`-syntax filter, e.g. `"siteCode:main"`. */
  q?: string;
  [key: string]: string | number | undefined;
}

/** Options for {@link FeeService.setItemFees} / {@link FeeService.setProductFees}. */
export interface SetItemFeesOptions {
  /** When true, merges instead of replacing (serialized to `?partial=true`). */
  partial?: boolean;
}
```

> If `Omit<Fee, "id" | "yrn">` produces a draft type the test or service rejects (e.g. the generated `Fee` marks `id` as required so create bodies fail), switch `FeeDraft`/`ItemFeeDraft` to the hand-written interfaces above. Either path keeps the public API identical.

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run:
```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/fee-types.test.ts
pnpm -F @viu/emporix-sdk typecheck
```
Expected: test PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/fee-types.ts packages/sdk/tests/services/fee-types.test.ts
git commit -m "feat(sdk): add fee public types"
```

---

## Task 3: FeeService

**Files:**
- Create: `packages/sdk/src/services/fee.ts`, `packages/sdk/src/fee.ts`
- Test: `packages/sdk/tests/services/fee.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/fee.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { FeeService } from "../../src/services/fee";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "fee" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new FeeService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const FEES = "https://api.emporix.io/fee/acme/fees";
const ITEM = "https://api.emporix.io/fee/acme/itemFees";
const PROD = "https://api.emporix.io/fee/acme/productFees";

const aFee = {
  id: "fee_1",
  name: { en: "Small order fee" },
  code: "small-order",
  feeType: "PERCENT",
  feePercentage: 2.5,
  siteCode: "main",
  active: true,
  yrn: "urn:yaas:saasag:fee:acme;fee_1",
};

describe("FeeService", () => {
  it("list wraps fees in a PaginatedItems envelope with server defaults", async () => {
    let seenAuth: string | null = null;
    let q: URLSearchParams | null = null;
    server.use(
      http.get(FEES, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        q = new URL(request.url).searchParams;
        return HttpResponse.json([aFee]);
      }),
    );
    const page = await svc().list();
    expect(seenAuth).toBe("Bearer svc-tok");
    expect((q as URLSearchParams | null)?.get("pageNumber")).toBe("1");
    expect((q as URLSearchParams | null)?.get("pageSize")).toBe("60");
    expect(page.items[0]?.code).toBe("small-order");
    expect(page.pageNumber).toBe(1);
    expect(page.pageSize).toBe(60);
    expect(page.hasNextPage).toBe(false);
  });

  it("list reports hasNextPage when the page is full and passes q/sort through", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.get(FEES, ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json(Array.from({ length: 2 }, (_, i) => ({ ...aFee, id: `fee_${i}` })));
      }),
    );
    const page = await svc().list({ pageSize: 2, q: "siteCode:main", sort: "code:asc" });
    expect(page.hasNextPage).toBe(true);
    expect((q as URLSearchParams | null)?.get("q")).toBe("siteCode:main");
    expect((q as URLSearchParams | null)?.get("sort")).toBe("code:asc");
  });

  it("get fetches one fee by id", async () => {
    server.use(http.get(`${FEES}/fee_1`, () => HttpResponse.json(aFee)));
    const f = await svc().get("fee_1");
    expect(f.id).toBe("fee_1");
  });

  it("get throws EmporixNotFoundError on 404", async () => {
    server.use(
      http.get(`${FEES}/missing`, () =>
        HttpResponse.json({ status: 404, message: "not found" }, { status: 404 }),
      ),
    );
    await expect(svc().get("missing")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("create POSTs the draft and returns the created fee", async () => {
    let body: unknown = null;
    server.use(
      http.post(FEES, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(aFee, { status: 201 });
      }),
    );
    const draft = {
      name: { en: "Small order fee" },
      code: "small-order",
      feeType: "PERCENT" as const,
      feePercentage: 2.5,
      siteCode: "main",
      active: true,
    };
    const created = await svc().create(draft);
    expect(body).toEqual(draft);
    expect(created.id).toBe("fee_1");
  });

  it("update PUTs the draft to /fees/{id} and returns the updated fee", async () => {
    let body: unknown = null;
    server.use(
      http.put(`${FEES}/fee_1`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...aFee, active: false });
      }),
    );
    const updated = await svc().update("fee_1", {
      name: { en: "Small order fee" },
      code: "small-order",
      feeType: "PERCENT",
      feePercentage: 2.5,
      siteCode: "main",
      active: false,
    });
    expect((body as { active?: boolean }).active).toBe(false);
    expect(updated.active).toBe(false);
  });

  it("delete DELETEs the fee and resolves to void", async () => {
    server.use(http.delete(`${FEES}/fee_1`, () => new HttpResponse(null, { status: 204 })));
    await expect(svc().delete("fee_1")).resolves.toBeUndefined();
  });

  it("listItemFees GETs /itemFees", async () => {
    server.use(http.get(ITEM, () => HttpResponse.json([{ id: "if_1", itemYrn: "y", feeIds: ["fee_1"], siteCode: "main" }])));
    const rows = await svc().listItemFees();
    expect(rows[0]?.id).toBe("if_1");
  });

  it("getItemFees GETs /itemFees/{yrn}/fees", async () => {
    let pathname = "";
    server.use(
      http.get(`${ITEM}/:yrn/fees`, ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json([{ id: "if_1", itemYrn: "urn:p:1", feeIds: ["fee_1"], siteCode: "main" }]);
      }),
    );
    const rows = await svc().getItemFees("urn:p:1");
    expect(pathname).toBe("/fee/acme/itemFees/urn%3Ap%3A1/fees");
    expect(rows[0]?.feeIds).toEqual(["fee_1"]);
  });

  it("createItemFee POSTs the mapping body", async () => {
    let body: unknown = null;
    server.use(
      http.post(ITEM, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "if_1", itemYrn: "urn:p:1", feeIds: ["fee_1"], siteCode: "main" }, { status: 201 });
      }),
    );
    const created = await svc().createItemFee({ itemYrn: "urn:p:1", feeIds: ["fee_1"], siteCode: "main" });
    expect(body).toEqual({ itemYrn: "urn:p:1", feeIds: ["fee_1"], siteCode: "main" });
    expect(created.id).toBe("if_1");
  });

  it("setItemFees PUTs to /itemFees/{yrn}/fees (destructive by default)", async () => {
    let body: unknown = null;
    let search = "x";
    server.use(
      http.put(`${ITEM}/:yrn/fees`, async ({ request }) => {
        body = await request.json();
        search = new URL(request.url).search;
        return HttpResponse.json({ id: "if_1", itemYrn: "urn:p:1", feeIds: ["fee_1", "fee_2"], siteCode: "main" });
      }),
    );
    const res = await svc().setItemFees("urn:p:1", ["fee_1", "fee_2"]);
    expect(body).toEqual({ feeIds: ["fee_1", "fee_2"] });
    expect(search).toBe("");
    expect(res.feeIds).toEqual(["fee_1", "fee_2"]);
  });

  it("setItemFees with partial:true adds ?partial=true", async () => {
    let partial: string | null = null;
    server.use(
      http.put(`${ITEM}/:yrn/fees`, ({ request }) => {
        partial = new URL(request.url).searchParams.get("partial");
        return HttpResponse.json({ id: "if_1", itemYrn: "urn:p:1", feeIds: ["fee_2"], siteCode: "main" });
      }),
    );
    await svc().setItemFees("urn:p:1", ["fee_2"], { partial: true });
    expect(partial).toBe("true");
  });

  it("deleteItemFees(yrn) DELETEs all mappings for the YRN", async () => {
    let pathname = "";
    server.use(
      http.delete(`${ITEM}/:yrn/fees`, ({ request }) => {
        pathname = new URL(request.url).pathname;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(svc().deleteItemFees("urn:p:1")).resolves.toBeUndefined();
    expect(pathname).toBe("/fee/acme/itemFees/urn%3Ap%3A1/fees");
  });

  it("deleteItemFees(yrn, feeId) DELETEs a single fee from the mapping", async () => {
    let pathname = "";
    server.use(
      http.delete(`${ITEM}/:yrn/fees/:feeId`, ({ request }) => {
        pathname = new URL(request.url).pathname;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(svc().deleteItemFees("urn:p:1", "fee_1")).resolves.toBeUndefined();
    expect(pathname).toBe("/fee/acme/itemFees/urn%3Ap%3A1/fees/fee_1");
  });

  it("searchItemFees POSTs {itemYrns,siteCode} to /itemFees/search", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${ITEM}/search`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json([{ id: "if_1", itemYrn: "urn:p:1", feeIds: ["fee_1"], siteCode: "main" }]);
      }),
    );
    const rows = await svc().searchItemFees({ itemYrns: ["urn:p:1"], siteCode: "main" });
    expect(body).toEqual({ itemYrns: ["urn:p:1"], siteCode: "main" });
    expect(rows[0]?.id).toBe("if_1");
  });

  it("getProductFees / setProductFees / deleteProductFees hit /productFees/{id}/fees", async () => {
    let putBody: unknown = null;
    server.use(
      http.get(`${PROD}/p1/fees`, () => HttpResponse.json([{ id: "pf_1", itemYrn: "urn:p:1", feeIds: ["fee_1"], siteCode: "main" }])),
      http.put(`${PROD}/p1/fees`, async ({ request }) => {
        putBody = await request.json();
        return HttpResponse.json({ id: "pf_1", itemYrn: "urn:p:1", feeIds: ["fee_1"], siteCode: "main" });
      }),
      http.delete(`${PROD}/p1/fees`, () => new HttpResponse(null, { status: 204 })),
    );
    const got = await svc().getProductFees("p1");
    expect(got[0]?.id).toBe("pf_1");
    await svc().setProductFees("p1", ["fee_1"]);
    expect(putBody).toEqual({ feeIds: ["fee_1"] });
    await expect(svc().deleteProductFees("p1")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/fee.test.ts`
Expected: FAIL — cannot find module `../../src/services/fee`.

- [ ] **Step 3: Write the service**

Create `packages/sdk/src/services/fee.ts`:

```ts
import type { ClientContext, PaginatedItems } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  Fee,
  ItemFee,
  FeeDraft,
  ItemFeeDraft,
  ItemFeeSearch,
  ListFeesQuery,
  SetItemFeesOptions,
} from "./fee-types";

export type {
  Fee,
  ItemFee,
  FeeDraft,
  ItemFeeDraft,
  ItemFeeSearch,
  ListFeesQuery,
  SetItemFeesOptions,
} from "./fee-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Emporix Fee Service (`/fee/{tenant}/…`): fee definitions plus the
 * item/product mappings that attach them. Writes require a backend-only scope
 * (`fee.fee_*` / `fee.item_*`); GETs need a token but no scope. Default auth:
 * service. Server-side use only — the service token must never reach a browser.
 *
 * Quirks (server behavior, not handled here): a payment-type fee's `code` must
 * equal the payment-mode code or the fee is silently ignored; a wrong/missing
 * `siteCode` filters to an empty array rather than erroring; an expired
 * `activeTimespan` silently disables the fee; `setItemFees`/`setProductFees`
 * replace the whole mapping unless `partial` is set.
 */
export class FeeService {
  constructor(private readonly ctx: ClientContext) {}

  private feesBase(): string {
    return `/fee/${this.ctx.tenant}/fees`;
  }

  private itemFeesBase(): string {
    return `/fee/${this.ctx.tenant}/itemFees`;
  }

  private productFeesBase(): string {
    return `/fee/${this.ctx.tenant}/productFees`;
  }

  // --- Fee definitions ---

  /**
   * List fee definitions, wrapped in the shared {@link PaginatedItems}
   * envelope (same heuristic as `media.list`: `hasNextPage` is true when the
   * returned page is full). Defaults match Emporix server defaults
   * (`pageNumber: 1`, `pageSize: 60`).
   */
  async list(query: ListFeesQuery = {}, auth: AuthContext = SERVICE): Promise<PaginatedItems<Fee>> {
    const pageNumber = query.pageNumber ?? 1;
    const pageSize = query.pageSize ?? 60;
    const items = await this.ctx.http.request<Fee[]>({
      method: "GET",
      path: this.feesBase(),
      auth,
      query: { ...query, pageNumber, pageSize },
    });
    return { items, pageNumber, pageSize, hasNextPage: items.length === pageSize };
  }

  /** Retrieve one fee definition by id. */
  async get(id: string, auth: AuthContext = SERVICE): Promise<Fee> {
    return this.ctx.http.request<Fee>({
      method: "GET",
      path: `${this.feesBase()}/${encodeURIComponent(id)}`,
      auth,
    });
  }

  /** Create a fee definition. */
  async create(draft: FeeDraft, auth: AuthContext = SERVICE): Promise<Fee> {
    return this.ctx.http.request<Fee>({
      method: "POST",
      path: this.feesBase(),
      auth,
      body: draft,
    });
  }

  /** Update a fee definition by id. */
  async update(id: string, draft: FeeDraft, auth: AuthContext = SERVICE): Promise<Fee> {
    return this.ctx.http.request<Fee>({
      method: "PUT",
      path: `${this.feesBase()}/${encodeURIComponent(id)}`,
      auth,
      body: draft,
    });
  }

  /** Delete a fee definition by id. */
  async delete(id: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.feesBase()}/${encodeURIComponent(id)}`,
      auth,
    });
  }

  // --- Item-fee mappings ---

  /** List all item-fee mappings. */
  async listItemFees(auth: AuthContext = SERVICE): Promise<ItemFee[]> {
    return this.ctx.http.request<ItemFee[]>({
      method: "GET",
      path: this.itemFeesBase(),
      auth,
    });
  }

  /** Fee mappings for one item YRN. */
  async getItemFees(itemYrn: string, auth: AuthContext = SERVICE): Promise<ItemFee[]> {
    return this.ctx.http.request<ItemFee[]>({
      method: "GET",
      path: `${this.itemFeesBase()}/${encodeURIComponent(itemYrn)}/fees`,
      auth,
    });
  }

  /** Create an item-fee mapping. */
  async createItemFee(draft: ItemFeeDraft, auth: AuthContext = SERVICE): Promise<ItemFee> {
    return this.ctx.http.request<ItemFee>({
      method: "POST",
      path: this.itemFeesBase(),
      auth,
      body: draft,
    });
  }

  /**
   * Set the fee list for an item YRN. Destructive replace by default; pass
   * `{ partial: true }` to merge (`?partial=true`).
   */
  async setItemFees(
    itemYrn: string,
    feeIds: string[],
    opts: SetItemFeesOptions = {},
    auth: AuthContext = SERVICE,
  ): Promise<ItemFee> {
    return this.ctx.http.request<ItemFee>({
      method: "PUT",
      path: `${this.itemFeesBase()}/${encodeURIComponent(itemYrn)}/fees`,
      auth,
      body: { feeIds },
      ...(opts.partial ? { query: { partial: true } } : {}),
    });
  }

  /**
   * Delete item-fee mappings for a YRN. Without `feeId`, removes all mappings
   * for the YRN; with `feeId`, removes that single fee from the mapping.
   */
  async deleteItemFees(itemYrn: string, feeId?: string, auth: AuthContext = SERVICE): Promise<void> {
    const base = `${this.itemFeesBase()}/${encodeURIComponent(itemYrn)}/fees`;
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: feeId ? `${base}/${encodeURIComponent(feeId)}` : base,
      auth,
    });
  }

  /** Search item-fee mappings by item YRNs + site. */
  async searchItemFees(search: ItemFeeSearch, auth: AuthContext = SERVICE): Promise<ItemFee[]> {
    return this.ctx.http.request<ItemFee[]>({
      method: "POST",
      path: `${this.itemFeesBase()}/search`,
      auth,
      body: search,
    });
  }

  // --- Product-fee mappings ---

  /** Fee mappings for a product id. */
  async getProductFees(productId: string, auth: AuthContext = SERVICE): Promise<ItemFee[]> {
    return this.ctx.http.request<ItemFee[]>({
      method: "GET",
      path: `${this.productFeesBase()}/${encodeURIComponent(productId)}/fees`,
      auth,
    });
  }

  /**
   * Set the fee list for a product id. Destructive replace by default; pass
   * `{ partial: true }` to merge (`?partial=true`).
   */
  async setProductFees(
    productId: string,
    feeIds: string[],
    opts: SetItemFeesOptions = {},
    auth: AuthContext = SERVICE,
  ): Promise<ItemFee> {
    return this.ctx.http.request<ItemFee>({
      method: "PUT",
      path: `${this.productFeesBase()}/${encodeURIComponent(productId)}/fees`,
      auth,
      body: { feeIds },
      ...(opts.partial ? { query: { partial: true } } : {}),
    });
  }

  /** Delete all fee mappings for a product id. */
  async deleteProductFees(productId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.productFeesBase()}/${encodeURIComponent(productId)}/fees`,
      auth,
    });
  }
}
```

Create the facade `packages/sdk/src/fee.ts`:

```ts
export * from "./services/fee";
```

> **Verify-during-implementation note (from the spec):** the `setItemFees`/`setProductFees` PUT body is assumed to be `{ feeIds }`. After Task 1, confirm the request schema for `PUT /itemFees/{itemYRN}/fees` in `packages/sdk/specs/fee.yml` (`grep -n "itemFees" packages/sdk/specs/fee.yml`, then inspect the operation's requestBody). If the server expects a different shape (e.g. a bare array, or `{ feeIds, siteCode }`), adjust the `body:` in both `setItemFees`/`setProductFees` and the matching test assertions. Likewise confirm the single-fee delete path is `…/fees/{feeId}` (not `…/{feeId}/fees`); the design records it as `…/fees/{feeId}`.

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run:
```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/fee.test.ts
pnpm -F @viu/emporix-sdk typecheck
```
Expected: all tests PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/fee.ts packages/sdk/src/fee.ts packages/sdk/tests/services/fee.test.ts
git commit -m "feat(sdk): add fee service"
```

---

## Task 4: Wire the service onto EmporixClient

**Files:**
- Modify: `packages/sdk/src/core/logger.ts`, `packages/sdk/src/client.ts`, `packages/sdk/src/index.ts`
- Test: `packages/sdk/tests/services/fee-wiring.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/fee-wiring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { FeeService } from "../../src/services/fee";

describe("EmporixClient fee wiring", () => {
  it("exposes the fees service", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.fees).toBeInstanceOf(FeeService);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/fee-wiring.test.ts`
Expected: FAIL — `sdk.fees` is `undefined` (not an instance).

- [ ] **Step 3a: Extend the `ServiceName` union**

In `packages/sdk/src/core/logger.ts`, add `"fee"` to the `ServiceName` union (insert before `| "http"`):

```ts
  | "availability"
  | "configuration"
  | "fee"
  | "http"
  | "auth";
```

- [ ] **Step 3b: Import and expose the service in `client.ts`**

In `packages/sdk/src/client.ts`, add the import next to the other service imports (e.g. after the `AvailabilityService` import):

```ts
import { FeeService } from "./services/fee";
```

Add the readonly field next to the other service fields (after `clientConfig`):

```ts
  readonly fees: FeeService;
```

Construct it in the constructor next to the other `this.x = new XService(mk(...))` lines (after `this.clientConfig = …`):

```ts
    this.fees = new FeeService(mk("fee"));
```

- [ ] **Step 3c: Re-export from the barrel**

In `packages/sdk/src/index.ts`, add this line next to the other `export * from "./<facade>"` lines (after `export * from "./client-config";`):

```ts
export * from "./fee";
```

- [ ] **Step 4: Run the test, full suite + typecheck**

Run:
```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/fee-wiring.test.ts
pnpm -F @viu/emporix-sdk test
pnpm -F @viu/emporix-sdk typecheck
```
Expected: wiring test PASS; full suite PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/core/logger.ts packages/sdk/src/client.ts packages/sdk/src/index.ts packages/sdk/tests/services/fee-wiring.test.ts
git commit -m "feat(sdk): expose fee service on the client"
```

---

## Task 5: Documentation

**Files:**
- Create: `docs/fee.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Write the usage doc**

Create `docs/fee.md`:

````markdown
# Fee Service

Bindings for the Emporix **Fee Service** (`/fee/{tenant}/…`): fee definitions
plus the `itemFees` / `productFees` mappings that attach them to catalog items.

> **Server-side only.** Writes require the backend `fee.fee_*` / `fee.item_*`
> scopes and GETs require a valid token, all served by the **service
> (clientCredentials) token**. Never construct these calls from a browser — the
> admin token must not be exposed. Use them in Node, Next.js route handlers /
> server actions, or other trusted backends.

## Fee definitions — `client.fees`

```ts
// list (paginated, server defaults pageNumber:1 / pageSize:60)
const page = await client.fees.list({ pageSize: 100, q: "siteCode:main" });
page.items;        // Fee[]
page.hasNextPage;  // true when the page was full

// get / create / update / delete
const fee = await client.fees.get("fee_1");
await client.fees.create({
  name: { en: "Small order fee" },
  code: "small-order",
  feeType: "PERCENT",
  feePercentage: 2.5,
  siteCode: "main",
  active: true,
});
await client.fees.update("fee_1", { /* full FeeDraft */ } as never);
await client.fees.delete("fee_1");
```

`feeType` selects the amount field: `PERCENT` → `feePercentage`; `ABSOLUTE` /
`ABSOLUTE_MULTIPLY_ITEMQUANTITY` → `feeAbsolute: { amount, currency }`. Set
`taxCode` whenever `taxable` is true. For a `PAYMENTTYPE` fee, `code` **must
equal the payment-mode code** or the fee is silently ignored.

## Item-fee mappings

```ts
const all = await client.fees.listItemFees();
const forItem = await client.fees.getItemFees("urn:yaas:…:product:p1");
await client.fees.createItemFee({ itemYrn: "urn:…:p1", feeIds: ["fee_1"], siteCode: "main" });

// set replaces the whole list by default; pass { partial: true } to merge
await client.fees.setItemFees("urn:…:p1", ["fee_1", "fee_2"]);
await client.fees.setItemFees("urn:…:p1", ["fee_3"], { partial: true });

// delete all mappings for the YRN, or one fee from it
await client.fees.deleteItemFees("urn:…:p1");
await client.fees.deleteItemFees("urn:…:p1", "fee_1");

// search by YRNs + site
const found = await client.fees.searchItemFees({ itemYrns: ["urn:…:p1"], siteCode: "main" });
```

## Product-fee mappings

```ts
const fees = await client.fees.getProductFees("p1");
await client.fees.setProductFees("p1", ["fee_1"]);           // destructive replace
await client.fees.setProductFees("p1", ["fee_2"], { partial: true });
await client.fees.deleteProductFees("p1");
```

## Quirks to know

- **Silent `siteCode` filtering:** a wrong or missing `siteCode` yields an empty
  array, not an error.
- **Destructive `set`:** `setItemFees` / `setProductFees` replace the entire fee
  list unless `partial: true`.
- **Expiry:** an `activeTimespan` whose `endDate` has passed silently disables
  the fee.

## Overriding the token

All methods take an optional trailing `auth` argument (default: the `"backend"`
service credential set). Pass `auth.service("other-set")` to use a different
configured credential set, or `auth.raw(token)` for a pre-obtained token.

## Out of scope

`POST /itemFees/searchByProductId` and `/itemFees/searchByProductIds` are not
bound — use `searchItemFees` (by YRN) instead. No React hooks; the admin token
must stay server-side.
````

- [ ] **Step 2: Update CLAUDE.md service list**

In `CLAUDE.md`, find the `packages/sdk` row in the workspace-layout table and add `Fee` to the parenthesized service list (append before the closing paren, after the most recently added service). For example, if the list currently ends `…, CustomerGroups, TenantConfig, ClientConfig)`, change it to `…, CustomerGroups, TenantConfig, ClientConfig, Fee)`. If the configuration services are not yet listed (they ship on a sibling branch), simply append `, Fee` before the closing paren of whatever the current list is.

- [ ] **Step 3: Commit**

```bash
git add docs/fee.md CLAUDE.md
git commit -m "docs(sdk): document the fee service"
```

---

## Task 6: Changeset

**Files:**
- Create: `.changeset/fee-service.md`

- [ ] **Step 1: Write the changeset**

Create `.changeset/fee-service.md`:

```markdown
---
"@viu/emporix-sdk": minor
---

Add Fee Service bindings: `client.fees` provides CRUD over fee definitions
(`list`/`get`/`create`/`update`/`delete`) plus item- and product-fee mappings
(`listItemFees`/`getItemFees`/`createItemFee`/`setItemFees`/`deleteItemFees`/
`searchItemFees`, `getProductFees`/`setProductFees`/`deleteProductFees`).
Server-side only — these use the service (clientCredentials) token and must not
be called from a browser.
```

- [ ] **Step 2: Verify the changeset is recognized**

Run: `pnpm changeset status --since=origin/main`
Expected: lists `@viu/emporix-sdk` for a minor bump, exit 0. (No `@viu/emporix-sdk-react` entry — this is core-only.)

- [ ] **Step 3: Commit**

```bash
git add .changeset/fee-service.md
git commit -m "chore(release): add fee service changeset"
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

- **Spec coverage:** D1 scope → Task 3 binds `/fees` CRUD (list/get/create/update/delete), `/itemFees` (listItemFees/getItemFees/createItemFee/setItemFees/deleteItemFees/searchItemFees), `/productFees` (getProductFees/setProductFees/deleteProductFees). D2 no React → no React tasks, changeset is `@viu/emporix-sdk` only (Task 6). D3 one service, name-prefixed methods → single `FeeService`. D4 `delete` for fees, `deleteItemFees`/`deleteProductFees` for mappings → Task 3. D5 codegen + thin aliases → Tasks 1–2. D6 service-token default → `const SERVICE` in Task 3, every method has trailing `auth = SERVICE`. D7 `PaginatedItems` for `list` → Task 3 `list`, tested. D8 `partial` option → `setItemFees`/`setProductFees`, tested. Deferred `searchByProductId(s)` documented in Task 5 doc + spec §9. No gaps.
- **Placeholder scan:** No TBD/TODO; every code step has full code. The two upstream-dependent uncertainties (generated type names; `set` PUT body shape + single-fee delete path) are concrete `grep`-verification steps with defined fallbacks, not placeholders.
- **Type consistency:** `Fee` / `ItemFee` / `FeeDraft` / `ItemFeeDraft` / `ItemFeeSearch` / `ListFeesQuery` / `SetItemFeesOptions` names match across Tasks 2→3. `request` (not `req`) used everywhere, matching `media.ts` / `tenant-config.ts`. Re-export list in `fee.ts` matches the type module's exports. Constructor is `(private readonly ctx: ClientContext)`; module-default `const SERVICE: AuthContext = { kind: "service" }` — both identical to the reference services.
- **Pattern fidelity:** fetch-specs key `fee`; logger name `"fee"`; `client.fees` via `mk("fee")`; facade `src/fee.ts` re-export; barrel `export * from "./fee"`. Commit scopes all `sdk`/`release` (allowlist) with lowercase first verb (`add`/`generate`/`expose`/`document`). MSW harness mocks `POST /oauth/token` → `svc-tok` and asserts `Bearer svc-tok`, matching `tenant-config.test.ts`.
