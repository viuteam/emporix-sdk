# Customer Segment Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `SegmentService` (storefront reads only — `segment_read_own`), cross-service hydrate helpers that turn segment-item IDs into real Products/Categories, and three React hooks (`useMySegments`, `useMySegmentItems`, `useMySegmentCategoryTree`).

**Architecture:** Vendor the Emporix customer-segments OpenAPI spec and generate types. `SegmentService` follows the existing service pattern (constructor takes `ClientContext`) and additionally receives `ProductService`/`CategoryService` via dependency injection from `EmporixClient` for the hydrate helpers. All methods require a customer/raw `AuthContext` (anonymous tokens are rejected via a shared `requireCustomer` helper). React hooks read the customer token from `EmporixProvider`'s storage and are disabled when logged out.

**Tech Stack:** TypeScript 5.x strict, `@hey-api/openapi-ts` (types only), tsup, vitest + msw, @testing-library/react + jsdom, Changesets, commitlint.

**Spec:** `docs/superpowers/specs/2026-05-20-customer-segments-design.md`.

**Branch:** `feat/customer-segments` (already created from `main`).

---

### Task 1: Vendor + generate the customer-segments spec

**Files:**
- Modify: `packages/sdk/scripts/fetch-specs.ts`
- Create (generated): `packages/sdk/specs/customer-segment.yml`, `packages/sdk/src/generated/customer-segment/`
- Create: `docs/superpowers/plans/plan-customer-segments-type-bindings.md`

- [ ] **Step 1: Add the spec source**

In `packages/sdk/scripts/fetch-specs.ts`, add a `customer-segment` entry to
the `SPECS` map (after the `media` line):

```ts
  media: `${BASE}/media/media/api-reference/api.yml`,
  "customer-segment": `${BASE}/companies-and-customers/customer-segments/api-reference/api.yml`,
```

- [ ] **Step 2: Fetch and generate**

Run:

```bash
pnpm --filter @viu/emporix-sdk fetch:specs
pnpm --filter @viu/emporix-sdk generate
```

Expected: `fetched customer-segment (<n> bytes)` and `generated customer-segment`. New files appear at `packages/sdk/specs/customer-segment.yml` and `packages/sdk/src/generated/customer-segment/{index.ts,types.gen.ts}`, each prefixed with the `// AUTO-GENERATED — do not edit` banner.

- [ ] **Step 3: Identify the canonical generated symbols**

Run:

```bash
cd packages/sdk/src/generated/customer-segment
grep -oE "^export type [A-Za-z0-9_]+" types.gen.ts | sed 's/export type //' \
  | grep -iE 'segment|item|category|tree|customer|assignment' | head -40
```

Read the output and pick the canonical names for:
- **Segment** (the segment retrieval shape — typically `Segment`)
- **Segment item assignment** (the row returned by `/segments[/{id}]/items` — typically `SegmentItem` or `ItemAssignment`)
- **Category-tree node** (the row returned by `/segments/items/category-trees`)

- [ ] **Step 4: Record the bindings**

Create `docs/superpowers/plans/plan-customer-segments-type-bindings.md`:

```markdown
# Plan — Customer Segments Type Bindings

Verified against `packages/sdk/src/generated/customer-segment/types.gen.ts`.

| Public alias | Generated symbol |
|---|---|
| `Segment` | `<segment read type>` |
| `SegmentItem` | `<item assignment row>` |
| `SegmentCategoryTreeNode` | `<category tree node>` |

Notes:
- The `type` field on a segment-item row discriminates `PRODUCT` vs
  `CATEGORY` assignments — used by `listMyProductIds`/`listMyCategoryIds`.
- The item assignment row exposes an `itemId` (or similarly-named field)
  carrying the referenced product/category id; record the exact field
  name here once verified.
```

Replace the `<…>` placeholders with the exact symbol names from Step 3,
and replace the "or similarly-named" note with the **verified** id-field
name (read it directly from the relevant generated type).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/scripts/fetch-specs.ts packages/sdk/specs/customer-segment.yml \
  packages/sdk/src/generated/customer-segment \
  docs/superpowers/plans/plan-customer-segments-type-bindings.md
git commit -m "chore(segment): vendor + generate the customer-segments spec"
```

---

### Task 2: Extract the shared `requireCustomer` guard

**Files:**
- Create: `packages/sdk/src/core/require-customer.ts`
- Modify: `packages/sdk/src/services/customer.ts`, `packages/sdk/src/services/payment.ts`
- Test: relies on the existing customer/payment tests already covering the guard

Two services (`customer.ts`, `payment.ts`) currently each define a private
`requireCustomer(auth)`. Extract a single shared helper so the new
`segment.ts` can use it without creating an import cycle through
`customer.ts`.

- [ ] **Step 1: Create the shared helper**

Create `packages/sdk/src/core/require-customer.ts`:

```ts
import type { AuthContext } from "./auth";
import { EmporixAuthError } from "./errors";

/**
 * Enforces a caller-owned customer or raw token. Throws `EmporixAuthError`
 * for any other `AuthContext` kind (or when `auth` is missing). Shared by
 * services whose endpoints require a customer scope (`/me`, payments,
 * customer-segments…).
 */
export function requireCustomer(auth: AuthContext | undefined): AuthContext {
  if (auth && (auth.kind === "customer" || auth.kind === "raw")) return auth;
  throw new EmporixAuthError("This operation requires a customer or raw AuthContext");
}
```

- [ ] **Step 2: Use the shared helper in `customer.ts`**

In `packages/sdk/src/services/customer.ts`, replace the local definition
of `requireCustomer` with an import. The current local function is:

```ts
function requireCustomer(auth: AuthContext | undefined): AuthContext {
  if (auth && (auth.kind === "customer" || auth.kind === "raw")) return auth;
  throw new EmporixAuthError("This operation requires a customer or raw AuthContext");
}
```

Delete that local function, and add the import next to the other core
imports at the top of the file:

```ts
import { requireCustomer } from "../core/require-customer";
```

Leave the existing `EmporixAuthError` import alone (it's still used
elsewhere in `customer.ts`).

- [ ] **Step 3: Use the shared helper in `payment.ts`**

In `packages/sdk/src/services/payment.ts`, do the same: delete the local
`requireCustomer` (it has the message `"payment-gateway requires a customer
or raw AuthContext"`), and import the shared one:

```ts
import { requireCustomer } from "../core/require-customer";
```

Note: the shared helper's message is generic — any test currently
asserting on the **exact** payment-specific message text must be updated
to assert on `EmporixAuthError` only, not the string. Run the payment
test in Step 4 and adjust if needed.

- [ ] **Step 4: Run the existing suites**

Run: `pnpm --filter @viu/emporix-sdk test && pnpm --filter @viu/emporix-sdk typecheck`
Expected: all tests pass; typecheck clean. If the payment test asserts on
the specific message string, change it to
`expect(...).rejects.toBeInstanceOf(EmporixAuthError)` only.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/core/require-customer.ts \
  packages/sdk/src/services/customer.ts packages/sdk/src/services/payment.ts
git commit -m "refactor(core): extract shared requireCustomer guard"
```

---

### Task 3: `SegmentService` — core reads + client wiring + exports

**Files:**
- Create: `packages/sdk/src/services/segment.ts`
- Create: `packages/sdk/src/segment.ts` (subpath barrel)
- Modify: `packages/sdk/src/client.ts`, `packages/sdk/src/core/logger.ts`, `packages/sdk/src/index.ts`, `packages/sdk/package.json`, `packages/sdk/tsup.config.ts`, `commitlint.config.js`
- Test: `packages/sdk/tests/services/segment.test.ts`

Substitute the generated symbol names per
`plan-customer-segments-type-bindings.md` throughout.

- [ ] **Step 1: Write the failing tests (core reads)**

Create `packages/sdk/tests/services/segment.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { SegmentService } from "../../src/services/segment";
import { ProductService } from "../../src/services/product";
import { CategoryService } from "../../src/services/category";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";
import { EmporixAuthError } from "../../src/core/errors";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function harness() {
  const cfg = {
    tenant: "acme",
    host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "segment" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  const ctx = { tenant: "acme", http: httpClient, tokenProvider, logger };
  const products = new ProductService(ctx);
  const categories = new CategoryService(ctx);
  return { svc: new SegmentService(ctx, { products, categories }), products, categories };
}

const CUST = { kind: "customer" as const, token: "cust-tok" };

describe("SegmentService.list / get", () => {
  it("list rejects an anonymous auth context", async () => {
    await expect(harness().svc.list({}, { kind: "anonymous" })).rejects.toBeInstanceOf(
      EmporixAuthError,
    );
  });

  it("list sends the customer Bearer and returns the segments array", async () => {
    let auth: string | null = null;
    server.use(
      http.get("https://api.emporix.io/customer-segment/acme/segments", ({ request }) => {
        auth = request.headers.get("authorization");
        return HttpResponse.json([{ id: "seg-1" }, { id: "seg-2" }]);
      }),
    );
    const rows = await harness().svc.list({}, CUST);
    expect(auth).toBe("Bearer cust-tok");
    expect(rows.map((r) => (r as { id?: string }).id)).toEqual(["seg-1", "seg-2"]);
  });

  it("get fetches a single segment by id", async () => {
    server.use(
      http.get("https://api.emporix.io/customer-segment/acme/segments/seg-1", () =>
        HttpResponse.json({ id: "seg-1", name: { en: "Premium" } }),
      ),
    );
    const s = await harness().svc.get("seg-1", CUST);
    expect((s as { id?: string }).id).toBe("seg-1");
  });
});

describe("SegmentService.listItems / listSegmentItems / getCategoryTree", () => {
  it("listItems sends siteCode/legalEntityId/onlyActive query params when provided", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.get(
        "https://api.emporix.io/customer-segment/acme/segments/items",
        ({ request }) => {
          q = new URL(request.url).searchParams;
          return HttpResponse.json([
            { type: "PRODUCT", itemId: "p1" },
            { type: "CATEGORY", itemId: "c1" },
          ]);
        },
      ),
    );
    const rows = await harness().svc.listItems(
      { siteCode: "main", legalEntityId: "le-1", onlyActive: true, q: "active" },
      CUST,
    );
    const params = q as URLSearchParams | null;
    expect(params?.get("siteCode")).toBe("main");
    expect(params?.get("legalEntityId")).toBe("le-1");
    expect(params?.get("onlyActive")).toBe("true");
    expect(params?.get("q")).toBe("active");
    expect(rows).toHaveLength(2);
  });

  it("listItems omits absent params", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.get(
        "https://api.emporix.io/customer-segment/acme/segments/items",
        ({ request }) => {
          q = new URL(request.url).searchParams;
          return HttpResponse.json([]);
        },
      ),
    );
    await harness().svc.listItems(undefined, CUST);
    const params = q as URLSearchParams | null;
    expect(params?.has("siteCode")).toBe(false);
    expect(params?.has("onlyActive")).toBe(false);
    expect(params?.has("q")).toBe(false);
  });

  it("listSegmentItems hits the per-segment items endpoint", async () => {
    server.use(
      http.get(
        "https://api.emporix.io/customer-segment/acme/segments/seg-1/items",
        () => HttpResponse.json([{ type: "PRODUCT", itemId: "p1" }]),
      ),
    );
    const rows = await harness().svc.listSegmentItems("seg-1", undefined, CUST);
    expect(rows).toHaveLength(1);
  });

  it("getCategoryTree calls /segments/items/category-trees", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.get(
        "https://api.emporix.io/customer-segment/acme/segments/items/category-trees",
        ({ request }) => {
          q = new URL(request.url).searchParams;
          return HttpResponse.json([{ id: "c1", isSegmentAssigned: true, children: [] }]);
        },
      ),
    );
    const tree = await harness().svc.getCategoryTree({ siteCode: "main" }, CUST);
    expect((q as URLSearchParams | null)?.get("siteCode")).toBe("main");
    expect(tree).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @viu/emporix-sdk test -- segment`
Expected: FAIL — `SegmentService` does not exist.

- [ ] **Step 3: Implement `SegmentService` (core reads)**

Create `packages/sdk/src/services/segment.ts` (substitute `Segment`,
`SegmentItem`, `SegmentCategoryTreeNode` with the names recorded in the
bindings doc):

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import { requireCustomer } from "../core/require-customer";
import type { ProductService } from "./product";
import type { CategoryService } from "./category";
import type {
  Segment as GeneratedSegment,
  SegmentItem as GeneratedSegmentItem,
  SegmentCategoryTreeNode as GeneratedSegmentCategoryTreeNode,
} from "../generated/customer-segment";

/** Generated segment types (read shapes — storefront `segment_read_own`). */
export type Segment = GeneratedSegment;
export type SegmentItem = GeneratedSegmentItem;
export type SegmentCategoryTreeNode = GeneratedSegmentCategoryTreeNode;

/** Cross-service hydrate dependencies, injected from `EmporixClient`. */
export interface SegmentServiceDeps {
  products: ProductService;
  categories: CategoryService;
}

function setIfDefined<V>(
  q: Record<string, string | number | undefined>,
  key: string,
  value: V | undefined,
): void {
  if (value !== undefined && value !== "") {
    q[key] = value as unknown as string | number;
  }
}

/**
 * Customer-segment reads. Every method requires a customer/raw
 * `AuthContext` — the `segment_read_own` scope is on the customer token.
 * The standard product/category endpoints do **not** auto-filter by
 * segment; the storefront uses these reads to discover what to fetch.
 */
export class SegmentService {
  constructor(
    private readonly ctx: ClientContext,
    private readonly deps: SegmentServiceDeps,
  ) {}

  private base(): string {
    return `/customer-segment/${this.ctx.tenant}/segments`;
  }

  /** Lists segments the caller belongs to (with `segment_read_own`). */
  async list(
    query: { q?: string; pageNumber?: number; pageSize?: number } = {},
    auth?: AuthContext,
  ): Promise<Segment[]> {
    const q: Record<string, string | number | undefined> = {};
    setIfDefined(q, "q", query.q);
    setIfDefined(q, "pageNumber", query.pageNumber);
    setIfDefined(q, "pageSize", query.pageSize);
    return this.ctx.http.request<Segment[]>({
      method: "GET",
      path: this.base(),
      auth: requireCustomer(auth),
      ...(Object.keys(q).length ? { query: q } : {}),
    });
  }

  /** Fetches a single segment by id. */
  async get(segmentId: string, auth?: AuthContext): Promise<Segment> {
    return this.ctx.http.request<Segment>({
      method: "GET",
      path: `${this.base()}/${segmentId}`,
      auth: requireCustomer(auth),
    });
  }

  /** Item assignments (PRODUCT + CATEGORY) across all the caller's active segments. */
  async listItems(
    query: {
      q?: string;
      siteCode?: string;
      legalEntityId?: string;
      onlyActive?: boolean;
    } = {},
    auth?: AuthContext,
  ): Promise<SegmentItem[]> {
    const q: Record<string, string | number | undefined> = {};
    setIfDefined(q, "q", query.q);
    setIfDefined(q, "siteCode", query.siteCode);
    setIfDefined(q, "legalEntityId", query.legalEntityId);
    if (query.onlyActive !== undefined) q.onlyActive = String(query.onlyActive);
    return this.ctx.http.request<SegmentItem[]>({
      method: "GET",
      path: `${this.base()}/items`,
      auth: requireCustomer(auth),
      ...(Object.keys(q).length ? { query: q } : {}),
    });
  }

  /** Item assignments of one specific segment. */
  async listSegmentItems(
    segmentId: string,
    query: {
      q?: string;
      legalEntityId?: string;
      pageNumber?: number;
      pageSize?: number;
    } = {},
    auth?: AuthContext,
  ): Promise<SegmentItem[]> {
    const q: Record<string, string | number | undefined> = {};
    setIfDefined(q, "q", query.q);
    setIfDefined(q, "legalEntityId", query.legalEntityId);
    setIfDefined(q, "pageNumber", query.pageNumber);
    setIfDefined(q, "pageSize", query.pageSize);
    return this.ctx.http.request<SegmentItem[]>({
      method: "GET",
      path: `${this.base()}/${segmentId}/items`,
      auth: requireCustomer(auth),
      ...(Object.keys(q).length ? { query: q } : {}),
    });
  }

  /** Category tree built only from the caller's active segments. */
  async getCategoryTree(
    query: { siteCode?: string; legalEntityId?: string } = {},
    auth?: AuthContext,
  ): Promise<SegmentCategoryTreeNode[]> {
    const q: Record<string, string | number | undefined> = {};
    setIfDefined(q, "siteCode", query.siteCode);
    setIfDefined(q, "legalEntityId", query.legalEntityId);
    return this.ctx.http.request<SegmentCategoryTreeNode[]>({
      method: "GET",
      path: `${this.base()}/items/category-trees`,
      auth: requireCustomer(auth),
      ...(Object.keys(q).length ? { query: q } : {}),
    });
  }
}
```

- [ ] **Step 4: Wire it into the client**

In `packages/sdk/src/client.ts`:

- Add the import after `import { MediaService } from "./services/media";`:
  ```ts
  import { MediaService } from "./services/media";
  import { SegmentService } from "./services/segment";
  ```
- Add the field after `readonly media: MediaService;`:
  ```ts
  readonly media: MediaService;
  readonly segments: SegmentService;
  ```
- Add the construction after `this.media = new MediaService(mk("media"));`:
  ```ts
  this.media = new MediaService(mk("media"));
  this.segments = new SegmentService(mk("segment"), {
    products: this.products,
    categories: this.categories,
  });
  ```

In `packages/sdk/src/core/logger.ts`, add `"segment"` to the `ServiceName`
union (after `"media"`, keeping the same `| "<name>"` formatting).

- [ ] **Step 5: Public exports & subpath**

Create `packages/sdk/src/segment.ts`:

```ts
export * from "./services/segment";
```

In `packages/sdk/src/index.ts`, after the media exports add:

```ts
export { SegmentService } from "./services/segment";
export type {
  Segment,
  SegmentItem,
  SegmentCategoryTreeNode,
  SegmentServiceDeps,
} from "./services/segment";
```

In `packages/sdk/package.json` `exports`, after the `"./media"` line add:

```json
    "./media": { "types": "./dist/media.d.ts", "import": "./dist/media.js", "require": "./dist/media.cjs" },
    "./segment": { "types": "./dist/segment.d.ts", "import": "./dist/segment.js", "require": "./dist/segment.cjs" }
```

(Add the trailing comma to the previous `"./media"` line.)

In `packages/sdk/tsup.config.ts`, add `"src/segment.ts",` to the `entry`
array (after `"src/media.ts",`).

In `commitlint.config.js`, add `"segment"` to the `scope-enum` array
(after `"media"`).

- [ ] **Step 6: Run tests + sdk typecheck + verify subpath build**

Run:

```bash
pnpm --filter @viu/emporix-sdk test -- segment
pnpm --filter @viu/emporix-sdk typecheck
pnpm --filter @viu/emporix-sdk build
ls packages/sdk/dist/segment.js packages/sdk/dist/segment.cjs packages/sdk/dist/segment.d.ts
```

Expected: all green; all three dist files exist; no "types condition
never used" warning.

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/services/segment.ts packages/sdk/src/segment.ts \
  packages/sdk/src/client.ts packages/sdk/src/core/logger.ts \
  packages/sdk/src/index.ts packages/sdk/package.json \
  packages/sdk/tsup.config.ts commitlint.config.js \
  packages/sdk/tests/services/segment.test.ts
git commit -m "feat(segment): add SegmentService (storefront reads only)"
```

---

### Task 4: Hydrate helpers (`listMyProductIds`/`listMyCategoryIds`/`listMyProducts`/`listMyCategories`)

**Files:**
- Modify: `packages/sdk/src/services/segment.ts`
- Test: `packages/sdk/tests/services/segment.test.ts`

The `SegmentItem` row's id-field name was recorded in
`plan-customer-segments-type-bindings.md` (Task 1). Substitute that name
for `itemId` throughout this task if it differs.

- [ ] **Step 1: Write the failing tests**

Append inside `packages/sdk/tests/services/segment.test.ts`:

```ts
describe("SegmentService hydrate helpers", () => {
  it("listMyProductIds filters listItems by type=PRODUCT", async () => {
    server.use(
      http.get(
        "https://api.emporix.io/customer-segment/acme/segments/items",
        () =>
          HttpResponse.json([
            { type: "PRODUCT", itemId: "p1" },
            { type: "CATEGORY", itemId: "c1" },
            { type: "PRODUCT", itemId: "p2" },
          ]),
      ),
    );
    const ids = await harness().svc.listMyProductIds(undefined, CUST);
    expect(ids).toEqual(["p1", "p2"]);
  });

  it("listMyCategoryIds filters listItems by type=CATEGORY", async () => {
    server.use(
      http.get(
        "https://api.emporix.io/customer-segment/acme/segments/items",
        () =>
          HttpResponse.json([
            { type: "PRODUCT", itemId: "p1" },
            { type: "CATEGORY", itemId: "c1" },
          ]),
      ),
    );
    const ids = await harness().svc.listMyCategoryIds(undefined, CUST);
    expect(ids).toEqual(["c1"]);
  });

  it("listMyProducts hydrates ids via ProductService.get in parallel", async () => {
    let productCalls = 0;
    server.use(
      http.get(
        "https://api.emporix.io/customer-segment/acme/segments/items",
        () =>
          HttpResponse.json([
            { type: "PRODUCT", itemId: "p1" },
            { type: "PRODUCT", itemId: "p2" },
          ]),
      ),
      http.get("https://api.emporix.io/product/acme/products/p1", () => {
        productCalls += 1;
        return HttpResponse.json({ id: "p1" });
      }),
      http.get("https://api.emporix.io/product/acme/products/p2", () => {
        productCalls += 1;
        return HttpResponse.json({ id: "p2" });
      }),
    );
    const products = await harness().svc.listMyProducts(undefined, CUST);
    expect(productCalls).toBe(2);
    expect(products.map((p) => (p as { id?: string }).id)).toEqual(["p1", "p2"]);
  });

  it("listMyCategories hydrates ids via CategoryService.get in parallel", async () => {
    server.use(
      http.get(
        "https://api.emporix.io/customer-segment/acme/segments/items",
        () =>
          HttpResponse.json([
            { type: "CATEGORY", itemId: "c1" },
            { type: "CATEGORY", itemId: "c2" },
          ]),
      ),
      http.get("https://api.emporix.io/category/acme/categories/c1", () =>
        HttpResponse.json({ id: "c1" }),
      ),
      http.get("https://api.emporix.io/category/acme/categories/c2", () =>
        HttpResponse.json({ id: "c2" }),
      ),
    );
    const cats = await harness().svc.listMyCategories(undefined, CUST);
    expect(cats.map((c) => (c as { id?: string }).id)).toEqual(["c1", "c2"]);
  });

  it("listMyProducts: a single failed product get rejects the whole batch", async () => {
    server.use(
      http.get(
        "https://api.emporix.io/customer-segment/acme/segments/items",
        () =>
          HttpResponse.json([
            { type: "PRODUCT", itemId: "p1" },
            { type: "PRODUCT", itemId: "p2" },
          ]),
      ),
      http.get("https://api.emporix.io/product/acme/products/p1", () =>
        HttpResponse.json({ id: "p1" }),
      ),
      http.get(
        "https://api.emporix.io/product/acme/products/p2",
        () => new HttpResponse(null, { status: 500 }),
      ),
    );
    await expect(harness().svc.listMyProducts(undefined, CUST)).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @viu/emporix-sdk test -- segment`
Expected: FAIL — the helpers don't exist yet.

- [ ] **Step 3: Implement the hydrate helpers**

In `packages/sdk/src/services/segment.ts`, append inside the
`SegmentService` class (after `getCategoryTree`). The type predicates use
the `type` discriminator field on `SegmentItem`. Substitute `itemId` with
the actual id-field name from `plan-customer-segments-type-bindings.md`:

```ts
  private async pickItemIds(
    kind: "PRODUCT" | "CATEGORY",
    query: Parameters<SegmentService["listItems"]>[0],
    auth: AuthContext | undefined,
  ): Promise<string[]> {
    const rows = await this.listItems(query, auth);
    const ids: string[] = [];
    for (const r of rows as Array<{ type?: string; itemId?: string }>) {
      if (r.type === kind && typeof r.itemId === "string") ids.push(r.itemId);
    }
    return ids;
  }

  /** Product ids assigned to the caller's active segments. */
  async listMyProductIds(
    query?: Parameters<SegmentService["listItems"]>[0],
    auth?: AuthContext,
  ): Promise<string[]> {
    return this.pickItemIds("PRODUCT", query ?? {}, auth);
  }

  /** Category ids assigned to the caller's active segments. */
  async listMyCategoryIds(
    query?: Parameters<SegmentService["listItems"]>[0],
    auth?: AuthContext,
  ): Promise<string[]> {
    return this.pickItemIds("CATEGORY", query ?? {}, auth);
  }

  /**
   * Hydrates `listMyProductIds` via `ProductService.get` in parallel.
   * Resolves in the same order as the id list. Any single failure rejects
   * the whole batch (`Promise.all`); use the id-list method + your own
   * tolerance strategy if partial success matters.
   */
  async listMyProducts(
    query?: Parameters<SegmentService["listItems"]>[0],
    auth?: AuthContext,
  ): Promise<Awaited<ReturnType<ProductService["get"]>>[]> {
    const ids = await this.listMyProductIds(query, auth);
    return Promise.all(ids.map((id) => this.deps.products.get(id, undefined, auth)));
  }

  /**
   * Hydrates `listMyCategoryIds` via `CategoryService.get` in parallel.
   * Same single-failure-rejects semantics as `listMyProducts`.
   */
  async listMyCategories(
    query?: Parameters<SegmentService["listItems"]>[0],
    auth?: AuthContext,
  ): Promise<Awaited<ReturnType<CategoryService["get"]>>[]> {
    const ids = await this.listMyCategoryIds(query, auth);
    return Promise.all(ids.map((id) => this.deps.categories.get(id, auth)));
  }
```

Note: `ProductService.get(productId, _opts, auth)` takes a second arg
(`_opts?: Record<string, never>` for forward compatibility); we pass
`undefined`. `CategoryService.get(categoryId, auth)` takes two args. If
your service signatures differ on this branch (e.g. category was changed
to also take an `_opts` arg), adjust the call site here.

- [ ] **Step 4: Run tests + sdk typecheck**

Run: `pnpm --filter @viu/emporix-sdk test -- segment && pnpm --filter @viu/emporix-sdk typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/segment.ts packages/sdk/tests/services/segment.test.ts
git commit -m "feat(segment): hydrate helpers (listMyProducts/Categories + ids)"
```

---

### Task 5: React hooks (`useMySegments`/`useMySegmentItems`/`useMySegmentCategoryTree`)

**Files:**
- Create: `packages/react/src/hooks/use-my-segments.ts`
- Modify: `packages/react/src/hooks/index.ts`, `packages/react/src/index.ts`
- Test: `packages/react/tests/use-my-segments.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/react/tests/use-my-segments.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import {
  useMySegments,
  useMySegmentItems,
  useMySegmentCategoryTree,
} from "../src/hooks/use-my-segments";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customer-segment/acme/segments", ({ request }) => {
    expect(request.headers.get("authorization")).toBe("Bearer cust");
    return HttpResponse.json([{ id: "seg-1" }]);
  }),
  http.get("https://api.emporix.io/customer-segment/acme/segments/items", () =>
    HttpResponse.json([{ type: "PRODUCT", itemId: "p1" }]),
  ),
  http.get(
    "https://api.emporix.io/customer-segment/acme/segments/items/category-trees",
    () => HttpResponse.json([{ id: "c1", children: [] }]),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap(storage = createMemoryStorage()) {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
}

describe("useMySegments / useMySegmentItems / useMySegmentCategoryTree", () => {
  it("useMySegments fetches with the customer token", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    const { result } = renderHook(() => useMySegments(), { wrapper: wrap(storage) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });

  it("useMySegments is disabled when no customer token is stored (no network call)", () => {
    const { result } = renderHook(() => useMySegments(), { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
  });

  it("useMySegmentItems fetches when logged in", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    const { result } = renderHook(
      () => useMySegmentItems({ onlyActive: true }),
      { wrapper: wrap(storage) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]).toMatchObject({ type: "PRODUCT", itemId: "p1" });
  });

  it("useMySegmentCategoryTree fetches when logged in", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    const { result } = renderHook(
      () => useMySegmentCategoryTree({ siteCode: "main" }),
      { wrapper: wrap(storage) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]).toMatchObject({ id: "c1" });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @viu/emporix-sdk-react test -- use-my-segments`
Expected: FAIL — the hook module does not exist.

- [ ] **Step 3: Implement the hooks**

Create `packages/react/src/hooks/use-my-segments.ts`:

```ts
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  auth,
  type AuthContext,
  type Segment,
  type SegmentItem,
  type SegmentCategoryTreeNode,
} from "@viu/emporix-sdk";
import { useEmporix } from "../provider";

function customerCtx(token: string | null): AuthContext {
  if (!token) throw new Error("requires a customer token in storage");
  return auth.customer(token);
}

/** Segments the logged-in customer belongs to (`segment_read_own`). */
export function useMySegments(
  query: { q?: string; pageNumber?: number; pageSize?: number } = {},
): UseQueryResult<Segment[]> {
  const { client, storage } = useEmporix();
  const token = storage.getCustomerToken();
  return useQuery({
    queryKey: ["emporix", "segment", "list", { tenant: client.tenant, query }],
    enabled: token !== null,
    queryFn: () => client.segments.list(query, customerCtx(token)),
  });
}

/** Item assignments (PRODUCT + CATEGORY) across the caller's active segments. */
export function useMySegmentItems(
  query: {
    q?: string;
    siteCode?: string;
    legalEntityId?: string;
    onlyActive?: boolean;
  } = {},
): UseQueryResult<SegmentItem[]> {
  const { client, storage } = useEmporix();
  const token = storage.getCustomerToken();
  return useQuery({
    queryKey: ["emporix", "segment", "items", { tenant: client.tenant, query }],
    enabled: token !== null,
    queryFn: () => client.segments.listItems(query, customerCtx(token)),
  });
}

/** Category tree filtered to the caller's segments. */
export function useMySegmentCategoryTree(
  query: { siteCode?: string; legalEntityId?: string } = {},
): UseQueryResult<SegmentCategoryTreeNode[]> {
  const { client, storage } = useEmporix();
  const token = storage.getCustomerToken();
  return useQuery({
    queryKey: ["emporix", "segment", "categoryTree", { tenant: client.tenant, query }],
    enabled: token !== null,
    queryFn: () => client.segments.getCategoryTree(query, customerCtx(token)),
  });
}
```

In `packages/react/src/hooks/index.ts`, add after the existing
`useProductMedia` line:

```ts
export { useProductMedia } from "./use-product-media";
export {
  useMySegments,
  useMySegmentItems,
  useMySegmentCategoryTree,
} from "./use-my-segments";
```

In `packages/react/src/index.ts`, add the three hooks to the
`from "./hooks/index"` re-export block (next to `useProductMedia`).

- [ ] **Step 4: Run tests + react typecheck**

Run: `pnpm build && pnpm --filter @viu/emporix-sdk-react test -- use-my-segments && pnpm --filter @viu/emporix-sdk-react typecheck`
Expected: PASS, typecheck clean. If react branch coverage drops below
80%, the most likely uncovered branch is `customerCtx(null)` — add a
focused test asserting an enabled hook with a `null` token throws via
react-query's `queryFn`. Do not lower the threshold.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/hooks/use-my-segments.ts packages/react/src/hooks/index.ts \
  packages/react/src/index.ts packages/react/tests/use-my-segments.test.tsx
git commit -m "feat(react): useMySegments / useMySegmentItems / useMySegmentCategoryTree"
```

---

### Task 6: Docs, changeset, green gate, finish

**Files:**
- Create: `docs/segments.md`
- Create: `.changeset/customer-segments.md`

- [ ] **Step 1: Write `docs/segments.md`**

Create `docs/segments.md`:

```markdown
# Customer Segments

Emporix's **Customer Segment** service scopes what a logged-in customer
sees: products, categories, and (separately) coupon eligibility. A segment
is a static membership list with explicit `customer` and `item` (PRODUCT
or CATEGORY) assignments — there is no rule engine. The standard product
and category endpoints do **not** auto-filter by segment; the storefront
discovers segment items first and then fetches the real product /
category objects.

> `customer-segment` is **not** the same as `customer-group`. Groups are a
> B2B permission/role concept that drives price-list selection (see
> [`docs/auth.md`](./auth.md)). Segments scope visibility — they do not
> affect prices.

## Auth model

Every Segment endpoint in the SDK requires a customer (or `raw`) token.
The platform scope is `customersegment.segment_read_own` (carried by
standard customer tokens) — anonymous tokens are rejected at the SDK
boundary with `EmporixAuthError`. In React, the hooks are `enabled: false`
when no customer token is stored, so no network call is made for guests.

## Storefront flow

```ts
// 1. Cheapest path: just need product IDs.
const productIds = await client.segments.listMyProductIds(
  { onlyActive: true },
  auth.customer(token),
);

// 2. Hydrate sugar — fetches the real products in parallel.
const products = await client.segments.listMyProducts(
  { onlyActive: true },
  auth.customer(token),
);

// 3. Categories work the same way.
const categories = await client.segments.listMyCategories(
  { onlyActive: true },
  auth.customer(token),
);

// 4. Navigation: a category tree built only from the customer's segments.
const tree = await client.segments.getCategoryTree(
  { siteCode: "main" },
  auth.customer(token),
);
```

## React

```tsx
const { data: segments } = useMySegments();
const { data: items }    = useMySegmentItems({ onlyActive: true });
const { data: tree }     = useMySegmentCategoryTree({ siteCode: "main" });
```

All three are disabled when there is no customer token in storage. They
share the `["emporix", "segment", …]` query-key prefix, so invalidating
that prefix on login/logout clears the segment cache.

## Out of scope

- Admin segment CRUD (`POST/PUT/PATCH/DELETE /segments`).
- Customer-assignment writes (assign/remove a customer to/from a segment).
- Item-assignment writes (assign/remove products/categories).
- Partial-success hydrate (`Promise.allSettled` variant) — `listMyProducts`
  / `listMyCategories` reject on the first failed `get` by design.
- Bulk product fetch via a single `?q=id:(p1,p2,…)` round-trip.
```

- [ ] **Step 2: Add the changeset**

Create `.changeset/customer-segments.md`:

```markdown
---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add `SegmentService` (storefront reads only): `list`, `get`, `listItems`,
`listSegmentItems`, `getCategoryTree`, plus the hydrate helpers
`listMyProductIds` / `listMyCategoryIds` / `listMyProducts` /
`listMyCategories` that map segment-item ids to real `Product` /
`Category` objects via parallel `products.get` / `categories.get` calls.
All methods require a customer/raw `AuthContext` and use the shared
`requireCustomer` guard (also adopted by `customer.ts` and `payment.ts`).

React adds three lightweight hooks: `useMySegments`, `useMySegmentItems`,
`useMySegmentCategoryTree`. Each reads the customer token from the
storage and is `enabled: false` when there is no token (no network call
for guests). Exposed on the `@viu/emporix-sdk/segment` subpath.
```

- [ ] **Step 3: Full green gate**

Run:

```bash
pnpm build && pnpm typecheck && pnpm -r --filter "./packages/*" test
```

Expected: build ok; typecheck clean across sdk/react/examples; sdk + react
suites pass; coverage ≥80% on `packages/*`.

- [ ] **Step 4: Commit**

```bash
git add docs/segments.md .changeset/customer-segments.md
git commit -m "docs(segment): storefront flow + auth model; add changeset"
```

- [ ] **Step 5: Finish the branch**

Use **superpowers:finishing-a-development-branch** (verify tests →
4-option menu → execute choice).

---

## Self-Review

- **Spec coverage:** §A codegen + auth → Task 1; shared `requireCustomer`
  → Task 2; §B core reads + wiring → Task 3; §C hydrate helpers via DI →
  Task 4; §E React hooks → Task 5; §release/docs → Task 6. Decisions 1
  (storefront-reads only), 2 (hydrate helpers), 3 (three hooks), 4 (DI),
  5 (`requireCustomer` rejecting anonymous) are all reflected.
- **Placeholder scan:** generated symbol names (`Segment`, `SegmentItem`,
  `SegmentCategoryTreeNode`) are bound in Task 1's bindings doc via a
  concrete grep + record step before any later task consumes them — the
  same accepted pattern as Plans A/B/D/Media. The `itemId` field name has
  the same "verify in bindings doc, substitute if different" note. All
  code blocks are complete; no `// fill in here` markers.
- **Type consistency:** `SegmentService`, `SegmentServiceDeps`,
  `list/get/listItems/listSegmentItems/getCategoryTree`,
  `listMyProductIds/listMyCategoryIds/listMyProducts/listMyCategories`,
  the `requireCustomer` import from `../core/require-customer`,
  `EmporixClient.segments`, `mk("segment")`, `ServiceName "segment"`,
  `./segment` subpath, `commitlint` scope `segment`, and the three React
  hook names match across the service, client wiring, exports, tests,
  hooks, docs, and changeset.
