# Segment Hydrate (Bulk Search + Paginated Hooks) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the N+1 hydrate in `SegmentService.listMyProducts`/`listMyCategories` with a single Emporix `POST /search` bulk-by-ids call, expose the result as the new generic `PaginatedItems<T>`, and ship four React hooks (`useMySegmentProducts`/`useMySegmentProductsInfinite` and `useMySegmentCategories`/`useMySegmentCategoriesInfinite`) that drive a "load more" UI.

**Architecture:** A new generic `PaginatedItems<T>` lives next to `Page<T>` in `core/context.ts`. New `ProductService.searchByIds` / `CategoryService.searchByIds` methods chunk the IDs (configurable, default 100) and POST `/search` with `q="id:(…)"`. `SegmentService.listItems` gains `pageNumber`/`pageSize`; `listMyProducts`/`listMyCategories` return `PaginatedItems<…>` with `hasNextPage` derived from the source segment-items page being full. The React hooks mirror the existing `useProducts` + `useProductsInfinite` pattern.

**Tech Stack:** TypeScript 5.x strict, vitest + msw, @testing-library/react + jsdom, @tanstack/react-query (`useQuery` + `useInfiniteQuery`), Changesets.

**Spec:** `docs/superpowers/specs/2026-05-20-segment-hydrate-bulk-design.md`.

**Branch:** `feat/segment-hydrate-bulk` (already created from `main`).

---

### Task 1: `PaginatedItems<T>` generic

**Files:**
- Modify: `packages/sdk/src/core/context.ts:14-19` (add the new interface after `Page<T>`)
- Modify: `packages/sdk/src/index.ts` (re-export the new type)

- [ ] **Step 1: Add the interface**

In `packages/sdk/src/core/context.ts`, after the existing `Page<T>`
interface (lines 14-19), add:

```ts
/**
 * A cursor-paged collection — `pageNumber`/`pageSize` indexing with a
 * `hasNextPage` signal driven by the source page being full. Distinct
 * from `Page<T>` (offset/limit/total). Used by services and hooks that
 * support "load more" pagination.
 */
export interface PaginatedItems<T> {
  items: T[];
  pageNumber: number;
  pageSize: number;
  hasNextPage: boolean;
}
```

- [ ] **Step 2: Re-export from the package index**

In `packages/sdk/src/index.ts`, locate the existing
`export type { ClientContext, Page } from "./core/context";` line and
extend it:

```ts
export type { ClientContext, Page, PaginatedItems } from "./core/context";
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @viu/emporix-sdk typecheck`
Expected: clean (additive, no behaviour change).

- [ ] **Step 4: Commit**

```bash
git add packages/sdk/src/core/context.ts packages/sdk/src/index.ts
git commit -m "feat(core): add PaginatedItems<T> generic"
```

---

### Task 2: `ProductService.searchByIds`

**Files:**
- Modify: `packages/sdk/src/services/product.ts`
- Test: `packages/sdk/tests/services/product.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe("ProductService", …)` block in
`packages/sdk/tests/services/product.test.ts` (the file already uses
tenant `acme` and the `svc()`/`server` harness):

```ts
  it("searchByIds POSTs /products/search with q=id:(…) and returns the array", async () => {
    let seenBody: { q?: string } | null = null;
    server.use(
      http.post("https://api.emporix.io/product/acme/products/search", async ({ request }) => {
        seenBody = (await request.json()) as { q?: string };
        return HttpResponse.json([{ id: "p1" }, { id: "p2" }]);
      }),
    );
    const products = await svc().searchByIds(["p1", "p2"]);
    expect(seenBody?.q).toBe("id:(p1,p2)");
    expect(products.map((p) => p.id as string)).toEqual(["p1", "p2"]);
  });

  it("searchByIds chunks ids according to chunkSize and concatenates results", async () => {
    const calls: string[] = [];
    server.use(
      http.post("https://api.emporix.io/product/acme/products/search", async ({ request }) => {
        const body = (await request.json()) as { q?: string };
        calls.push(body.q ?? "");
        const ids = (body.q ?? "")
          .replace(/^id:\(/, "")
          .replace(/\)$/, "")
          .split(",")
          .filter(Boolean);
        return HttpResponse.json(ids.map((id) => ({ id })));
      }),
    );
    const products = await svc().searchByIds(["a", "b", "c", "d", "e"], { chunkSize: 2 });
    expect(calls).toEqual(["id:(a,b)", "id:(c,d)", "id:(e)"]);
    expect(products.map((p) => p.id as string).sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("searchByIds short-circuits on an empty id list (no HTTP call)", async () => {
    let hit = false;
    server.use(
      http.post("https://api.emporix.io/product/acme/products/search", () => {
        hit = true;
        return HttpResponse.json([]);
      }),
    );
    expect(await svc().searchByIds([])).toEqual([]);
    expect(hit).toBe(false);
  });
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @viu/emporix-sdk test -- product`
Expected: FAIL — `svc().searchByIds` is not a function.

- [ ] **Step 3: Implement `searchByIds`**

In `packages/sdk/src/services/product.ts`, append inside the
`ProductService` class (after `search()` and before the `readonly
media`-replacement helpers — i.e. before the closing `}` of the class):

```ts
  /**
   * Bulk fetch by id. POSTs `/products/search` with `q="id:(id1,id2,…)"`,
   * chunking when the list is larger than `options.chunkSize` (default
   * 100). An empty list short-circuits with no HTTP call. **Order is not
   * guaranteed** across chunks — re-index by `id` if order matters.
   */
  async searchByIds(
    ids: string[],
    options: { chunkSize?: number } = {},
    auth: AuthContext = ANON,
  ): Promise<Product[]> {
    if (ids.length === 0) return [];
    const chunkSize = options.chunkSize ?? 100;
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += chunkSize) {
      chunks.push(ids.slice(i, i + chunkSize));
    }
    const pages = await Promise.all(
      chunks.map((chunk) =>
        this.ctx.http.request<Product[]>({
          method: "POST",
          path: `/product/${this.ctx.tenant}/products/search`,
          query: { pageSize: chunk.length },
          auth,
          body: { q: `id:(${chunk.join(",")})` },
        }),
      ),
    );
    return pages.flat();
  }
```

- [ ] **Step 4: Run tests + sdk typecheck**

Run: `pnpm --filter @viu/emporix-sdk test -- product && pnpm --filter @viu/emporix-sdk typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/product.ts packages/sdk/tests/services/product.test.ts
git commit -m "feat(product): add searchByIds (bulk-by-ids via POST /search)"
```

---

### Task 3: `CategoryService.searchByIds`

**Files:**
- Modify: `packages/sdk/src/services/category.ts`
- Test: `packages/sdk/tests/services/category.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe("CategoryService", …)` block in
`packages/sdk/tests/services/category.test.ts`:

```ts
  it("searchByIds POSTs /categories/search with q=id:(…) and returns the array", async () => {
    let seenBody: { q?: string } | null = null;
    server.use(
      http.post("https://api.emporix.io/category/acme/categories/search", async ({ request }) => {
        seenBody = (await request.json()) as { q?: string };
        return HttpResponse.json([{ id: "c1" }, { id: "c2" }]);
      }),
    );
    const cats = await svc().searchByIds(["c1", "c2"]);
    expect(seenBody?.q).toBe("id:(c1,c2)");
    expect(cats.map((c) => c.id as string)).toEqual(["c1", "c2"]);
  });

  it("searchByIds chunks ids and concatenates", async () => {
    const calls: string[] = [];
    server.use(
      http.post("https://api.emporix.io/category/acme/categories/search", async ({ request }) => {
        const body = (await request.json()) as { q?: string };
        calls.push(body.q ?? "");
        const ids = (body.q ?? "")
          .replace(/^id:\(/, "")
          .replace(/\)$/, "")
          .split(",")
          .filter(Boolean);
        return HttpResponse.json(ids.map((id) => ({ id })));
      }),
    );
    const cats = await svc().searchByIds(["a", "b", "c"], { chunkSize: 2 });
    expect(calls).toEqual(["id:(a,b)", "id:(c)"]);
    expect(cats.map((c) => c.id as string).sort()).toEqual(["a", "b", "c"]);
  });

  it("searchByIds short-circuits on an empty id list", async () => {
    let hit = false;
    server.use(
      http.post("https://api.emporix.io/category/acme/categories/search", () => {
        hit = true;
        return HttpResponse.json([]);
      }),
    );
    expect(await svc().searchByIds([])).toEqual([]);
    expect(hit).toBe(false);
  });
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @viu/emporix-sdk test -- category`
Expected: FAIL — `svc().searchByIds` is not a function.

- [ ] **Step 3: Implement `searchByIds`**

In `packages/sdk/src/services/category.ts`, append inside the
`CategoryService` class (after the last existing method, before the
closing `}`):

```ts
  /**
   * Bulk fetch by id. POSTs `/categories/search` with `q="id:(id1,id2,…)"`,
   * chunking when the list is larger than `options.chunkSize` (default
   * 100). An empty list short-circuits with no HTTP call. **Order is not
   * guaranteed** across chunks — re-index by `id` if order matters.
   */
  async searchByIds(
    ids: string[],
    options: { chunkSize?: number } = {},
    auth: AuthContext = ANON,
  ): Promise<Category[]> {
    if (ids.length === 0) return [];
    const chunkSize = options.chunkSize ?? 100;
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += chunkSize) {
      chunks.push(ids.slice(i, i + chunkSize));
    }
    const pages = await Promise.all(
      chunks.map((chunk) =>
        this.ctx.http.request<Category[]>({
          method: "POST",
          path: `/category/${this.ctx.tenant}/categories/search`,
          query: { pageSize: chunk.length },
          auth,
          body: { q: `id:(${chunk.join(",")})` },
        }),
      ),
    );
    return pages.flat();
  }
```

- [ ] **Step 4: Run tests + sdk typecheck**

Run: `pnpm --filter @viu/emporix-sdk test -- category && pnpm --filter @viu/emporix-sdk typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/category.ts packages/sdk/tests/services/category.test.ts
git commit -m "feat(category): add searchByIds (bulk-by-ids via POST /search)"
```

---

### Task 4: `SegmentService.listItems` pagination + hydrate refactor to `PaginatedItems<…>`

**Files:**
- Modify: `packages/sdk/src/services/segment.ts`
- Modify: `packages/sdk/src/index.ts` (re-export `PaginatedItems` already done in Task 1; verify the `Segment*` exports list is unchanged)
- Test: `packages/sdk/tests/services/segment.test.ts`

This is the **breaking** task. The two hydrate methods change return
type from `Promise<Product[]>` / `Promise<Category[]>` to
`Promise<PaginatedItems<Product>>` / `Promise<PaginatedItems<Category>>`.

- [ ] **Step 1: Rewrite the existing hydrate-helper tests to the new shape**

In `packages/sdk/tests/services/segment.test.ts`, the existing block
under `describe("SegmentService hydrate helpers", …)` contains four
tests built around the old N+1 `products.get(id)` pattern. Replace
them with these (the existing block can be deleted wholesale and
replaced):

```ts
describe("SegmentService hydrate helpers", () => {
  it("listMyProductIds filters listItems by type=PRODUCT (reads item.id)", async () => {
    server.use(
      http.get(
        "https://api.emporix.io/customer-segment/acme/segments/items",
        () =>
          HttpResponse.json([
            { type: "PRODUCT", item: { id: "p1" } },
            { type: "CATEGORY", item: { id: "c1" } },
            { type: "PRODUCT", item: { id: "p2" } },
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
            { type: "PRODUCT", item: { id: "p1" } },
            { type: "CATEGORY", item: { id: "c1" } },
          ]),
      ),
    );
    const ids = await harness().svc.listMyCategoryIds(undefined, CUST);
    expect(ids).toEqual(["c1"]);
  });

  it("listMyProducts hydrates via ONE products.searchByIds call and returns a PaginatedItems page", async () => {
    let searchCalls = 0;
    let pageItemsParams: URLSearchParams | null = null;
    server.use(
      http.get(
        "https://api.emporix.io/customer-segment/acme/segments/items",
        ({ request }) => {
          pageItemsParams = new URL(request.url).searchParams;
          return HttpResponse.json([
            { type: "PRODUCT", item: { id: "p1" } },
            { type: "PRODUCT", item: { id: "p2" } },
          ]);
        },
      ),
      http.post(
        "https://api.emporix.io/product/acme/products/search",
        async ({ request }) => {
          searchCalls += 1;
          const body = (await request.json()) as { q?: string };
          expect(body.q).toBe("id:(p1,p2)");
          return HttpResponse.json([{ id: "p1" }, { id: "p2" }]);
        },
      ),
    );
    const page = await harness().svc.listMyProducts(
      { pageNumber: 2, pageSize: 20, onlyActive: true },
      CUST,
    );
    expect(searchCalls).toBe(1); // ONE bulk call, not N
    expect(page.items.map((p) => (p as { id?: string }).id)).toEqual(["p1", "p2"]);
    expect(page.pageNumber).toBe(2);
    expect(page.pageSize).toBe(20);
    expect(page.hasNextPage).toBe(false); // source page had 2 rows, pageSize 20 → not full
    const q = pageItemsParams as URLSearchParams | null;
    expect(q?.get("pageNumber")).toBe("2");
    expect(q?.get("pageSize")).toBe("20");
    expect(q?.get("onlyActive")).toBe("true");
  });

  it("listMyProducts.hasNextPage is true when the source page is full", async () => {
    server.use(
      http.get(
        "https://api.emporix.io/customer-segment/acme/segments/items",
        () =>
          HttpResponse.json([
            { type: "PRODUCT", item: { id: "p1" } },
            { type: "PRODUCT", item: { id: "p2" } },
          ]),
      ),
      http.post(
        "https://api.emporix.io/product/acme/products/search",
        () => HttpResponse.json([{ id: "p1" }, { id: "p2" }]),
      ),
    );
    const page = await harness().svc.listMyProducts(
      { pageNumber: 1, pageSize: 2 },
      CUST,
    );
    expect(page.hasNextPage).toBe(true); // 2 source rows, pageSize 2 → full
  });

  it("listMyProducts returns items:[] (no HTTP search) when the page has zero PRODUCT rows", async () => {
    let hit = false;
    server.use(
      http.get(
        "https://api.emporix.io/customer-segment/acme/segments/items",
        () => HttpResponse.json([{ type: "CATEGORY", item: { id: "c1" } }]),
      ),
      http.post(
        "https://api.emporix.io/product/acme/products/search",
        () => {
          hit = true;
          return HttpResponse.json([]);
        },
      ),
    );
    const page = await harness().svc.listMyProducts(undefined, CUST);
    expect(hit).toBe(false);
    expect(page.items).toEqual([]);
  });

  it("listMyCategories hydrates via ONE categories.searchByIds call and returns a PaginatedItems page", async () => {
    let searchCalls = 0;
    server.use(
      http.get(
        "https://api.emporix.io/customer-segment/acme/segments/items",
        () =>
          HttpResponse.json([
            { type: "CATEGORY", item: { id: "c1" } },
            { type: "CATEGORY", item: { id: "c2" } },
          ]),
      ),
      http.post(
        "https://api.emporix.io/category/acme/categories/search",
        async ({ request }) => {
          searchCalls += 1;
          const body = (await request.json()) as { q?: string };
          expect(body.q).toBe("id:(c1,c2)");
          return HttpResponse.json([{ id: "c1" }, { id: "c2" }]);
        },
      ),
    );
    const page = await harness().svc.listMyCategories(undefined, CUST);
    expect(searchCalls).toBe(1);
    expect(page.items.map((c) => (c as { id?: string }).id)).toEqual(["c1", "c2"]);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @viu/emporix-sdk test -- segment`
Expected: FAIL — the hydrate methods still return a flat array and
don't forward `pageNumber`/`pageSize` to `listItems`.

- [ ] **Step 3: Extend `listItems` with `pageNumber`/`pageSize`**

In `packages/sdk/src/services/segment.ts`, replace the existing
`listItems` signature + body with:

```ts
  /** Item assignments (PRODUCT + CATEGORY) across all the caller's active segments. */
  async listItems(
    query: {
      q?: string;
      siteCode?: string;
      legalEntityId?: string;
      onlyActive?: boolean;
      pageNumber?: number;
      pageSize?: number;
    } = {},
    auth?: AuthContext,
  ): Promise<SegmentItem[]> {
    const q: Record<string, string | number | undefined> = {};
    setIfDefined(q, "q", query.q);
    setIfDefined(q, "siteCode", query.siteCode);
    setIfDefined(q, "legalEntityId", query.legalEntityId);
    setIfDefined(q, "pageNumber", query.pageNumber);
    setIfDefined(q, "pageSize", query.pageSize);
    if (query.onlyActive !== undefined) q.onlyActive = String(query.onlyActive);
    return this.ctx.http.request<SegmentItem[]>({
      method: "GET",
      path: `${this.base()}/items`,
      auth: requireCustomer(auth),
      ...(Object.keys(q).length ? { query: q } : {}),
    });
  }
```

- [ ] **Step 4: Add `PaginatedItems` import + refactor the hydrate helpers**

In `packages/sdk/src/services/segment.ts`, extend the existing
`import type { ClientContext } from "../core/context";` line to:

```ts
import type { ClientContext, PaginatedItems } from "../core/context";
```

Then replace the existing `listMyProducts` and `listMyCategories`
methods (the ones that do `Promise.all(ids.map(get))`) with these
page-shaped versions:

```ts
  /**
   * Hydrates a page of the caller's segment PRODUCT assignments into real
   * products via one bulk `products.searchByIds` call. The page's
   * `hasNextPage` is derived from the source segment-items page being
   * full (`sourceItems.length === pageSize`), not from the hydrated
   * `items` count.
   */
  async listMyProducts(
    query?: Parameters<SegmentService["listItems"]>[0],
    auth?: AuthContext,
  ): Promise<PaginatedItems<Awaited<ReturnType<ProductService["get"]>>>> {
    const pageNumber = query?.pageNumber ?? 1;
    const pageSize = query?.pageSize ?? 20;
    const sourceItems = await this.listItems(
      { ...(query ?? {}), pageNumber, pageSize },
      auth,
    );
    const ids: string[] = [];
    for (const r of sourceItems) {
      if (r.type === "PRODUCT" && typeof r.item?.id === "string") ids.push(r.item.id);
    }
    const items = await this.deps.products.searchByIds(ids, undefined, auth);
    return { items, pageNumber, pageSize, hasNextPage: sourceItems.length === pageSize };
  }

  /**
   * Hydrates a page of the caller's segment CATEGORY assignments into
   * real categories via one bulk `categories.searchByIds` call.
   * Same `hasNextPage` semantic as `listMyProducts`.
   */
  async listMyCategories(
    query?: Parameters<SegmentService["listItems"]>[0],
    auth?: AuthContext,
  ): Promise<PaginatedItems<Awaited<ReturnType<CategoryService["get"]>>>> {
    const pageNumber = query?.pageNumber ?? 1;
    const pageSize = query?.pageSize ?? 20;
    const sourceItems = await this.listItems(
      { ...(query ?? {}), pageNumber, pageSize },
      auth,
    );
    const ids: string[] = [];
    for (const r of sourceItems) {
      if (r.type === "CATEGORY" && typeof r.item?.id === "string") ids.push(r.item.id);
    }
    const items = await this.deps.categories.searchByIds(ids, undefined, auth);
    return { items, pageNumber, pageSize, hasNextPage: sourceItems.length === pageSize };
  }
```

(The `listMyProductIds` / `listMyCategoryIds` methods stay as they are —
flat `Promise<string[]>` returns are still useful and don't need
pagination.)

- [ ] **Step 5: Run tests + sdk typecheck**

Run: `pnpm --filter @viu/emporix-sdk test -- segment && pnpm --filter @viu/emporix-sdk typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/services/segment.ts packages/sdk/tests/services/segment.test.ts
git commit -m "feat(segment)!: hydrate via bulk searchByIds; return PaginatedItems"
```

The `!` in the message marks the breaking change (conventional-commits).

---

### Task 5: React hooks — `useMySegmentProducts` (single page + infinite)

**Files:**
- Modify: `packages/react/src/hooks/use-my-segments.ts`
- Modify: `packages/react/src/hooks/index.ts`, `packages/react/src/index.ts`
- Test: `packages/react/tests/use-my-segment-products.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/react/tests/use-my-segment-products.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import {
  useMySegmentProducts,
  useMySegmentProductsInfinite,
} from "../src/hooks/use-my-segments";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customer-segment/acme/segments/items", ({ request }) => {
    const pn = Number(new URL(request.url).searchParams.get("pageNumber") ?? "1");
    if (pn === 1) {
      return HttpResponse.json([
        { type: "PRODUCT", item: { id: "p1" } },
        { type: "PRODUCT", item: { id: "p2" } },
      ]);
    }
    if (pn === 2) {
      return HttpResponse.json([{ type: "PRODUCT", item: { id: "p3" } }]);
    }
    return HttpResponse.json([]);
  }),
  http.post("https://api.emporix.io/product/acme/products/search", async ({ request }) => {
    const body = (await request.json()) as { q?: string };
    const ids = (body.q ?? "")
      .replace(/^id:\(/, "")
      .replace(/\)$/, "")
      .split(",")
      .filter(Boolean);
    return HttpResponse.json(ids.map((id) => ({ id })));
  }),
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

describe("useMySegmentProducts (single page)", () => {
  it("returns the PaginatedItems<Product> shape", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    const { result } = renderHook(
      () => useMySegmentProducts({ pageSize: 2 }),
      { wrapper: wrap(storage) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items.map((p) => (p as { id?: string }).id)).toEqual([
      "p1",
      "p2",
    ]);
    expect(result.current.data?.pageNumber).toBe(1);
    expect(result.current.data?.pageSize).toBe(2);
    expect(result.current.data?.hasNextPage).toBe(true);
  });

  it("is disabled when no customer token is stored", () => {
    const { result } = renderHook(() => useMySegmentProducts(), { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
  });
});

describe("useMySegmentProductsInfinite", () => {
  it("fetches page 1 and then page 2 via fetchNextPage; hasNextPage flips false", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    const { result } = renderHook(
      () => useMySegmentProductsInfinite({ pageSize: 2 }),
      { wrapper: wrap(storage) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages).toHaveLength(1);
    expect(result.current.hasNextPage).toBe(true);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    const all = (result.current.data?.pages ?? []).flatMap((p) => p.items);
    expect(all.map((p) => (p as { id?: string }).id)).toEqual(["p1", "p2", "p3"]);
    expect(result.current.hasNextPage).toBe(false); // page 2 was short
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @viu/emporix-sdk-react test -- use-my-segment-products`
Expected: FAIL — neither hook is exported.

- [ ] **Step 3: Add the two product hooks**

In `packages/react/src/hooks/use-my-segments.ts`, add at the top of
the existing imports (the file already imports `useQuery`,
`UseQueryResult`, `auth`, etc.):

```ts
import {
  useQuery,
  useInfiniteQuery,
  type UseQueryResult,
  type UseInfiniteQueryResult,
} from "@tanstack/react-query";
```

(Replace the existing `import { useQuery, type UseQueryResult } from "@tanstack/react-query";`
line entirely with the multi-import above.)

Add to the existing `from "@viu/emporix-sdk"` import block at the top
of the file: `PaginatedItems` next to the existing `Segment` /
`SegmentItem` / `SegmentCategoryTree` types.

Append at the bottom of the file:

```ts
type ProductPage = PaginatedItems<
  Awaited<ReturnType<typeof clientPlaceholder>>
>;

// `Awaited<ReturnType<>>` doesn't have a way to reference the SDK's
// `Product` element directly from the React package without importing it;
// we type the hook generically via `Awaited<…>` on the client method.

/** Hydrated PRODUCT page for the caller's segments. */
export function useMySegmentProducts(
  query: {
    q?: string;
    siteCode?: string;
    legalEntityId?: string;
    onlyActive?: boolean;
    pageNumber?: number;
    pageSize?: number;
  } = {},
): UseQueryResult<
  Awaited<ReturnType<typeof segmentsListMyProducts>>
> {
  const { client, storage } = useEmporix();
  const token = storage.getCustomerToken();
  return useQuery({
    queryKey: [
      "emporix",
      "segment",
      "myProducts",
      { tenant: client.tenant, query },
    ],
    enabled: token !== null,
    queryFn: () => client.segments.listMyProducts(query, customerCtx(token)),
  });
}

/** Hydrated PRODUCT pages — infinite scroll. */
export function useMySegmentProductsInfinite(
  query: {
    q?: string;
    siteCode?: string;
    legalEntityId?: string;
    onlyActive?: boolean;
    pageSize?: number;
  } = {},
): UseInfiniteQueryResult<
  {
    pages: Awaited<ReturnType<typeof segmentsListMyProducts>>[];
    pageParams: number[];
  },
  unknown
> {
  const { client, storage } = useEmporix();
  const token = storage.getCustomerToken();
  return useInfiniteQuery({
    queryKey: [
      "emporix",
      "segment",
      "myProductsInfinite",
      { tenant: client.tenant, query },
    ],
    enabled: token !== null,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      client.segments.listMyProducts(
        { ...query, pageNumber: pageParam as number, pageSize: query.pageSize ?? 20 },
        customerCtx(token),
      ),
    getNextPageParam: (last) => (last.hasNextPage ? last.pageNumber + 1 : undefined),
  });
}

// Type-only helper — references the SDK method's return shape without
// importing the `Product` type into this file (the SDK does not re-export
// the per-element Product alias in a stable way; deriving from the method
// keeps the hook in sync with whatever the SDK returns).
declare const clientPlaceholder: () => Promise<unknown>;
declare const segmentsListMyProducts: (
  query?: unknown,
  auth?: unknown,
) => Promise<{
  items: unknown[];
  pageNumber: number;
  pageSize: number;
  hasNextPage: boolean;
}>;
```

(The two `declare const` are pure type-helpers — they have no runtime
output and only exist so the hook's return type tracks the SDK's
`listMyProducts` shape.)

- [ ] **Step 4: Export the hooks**

In `packages/react/src/hooks/index.ts`, replace the existing line:

```ts
export {
  useMySegments,
  useMySegmentItems,
  useMySegmentCategoryTree,
} from "./use-my-segments";
```

with:

```ts
export {
  useMySegments,
  useMySegmentItems,
  useMySegmentCategoryTree,
  useMySegmentProducts,
  useMySegmentProductsInfinite,
} from "./use-my-segments";
```

In `packages/react/src/index.ts`, add the two new names to the
`from "./hooks/index"` re-export block, next to `useMySegmentCategoryTree`.

- [ ] **Step 5: Run tests + react typecheck**

Run: `pnpm build && pnpm --filter @viu/emporix-sdk-react test -- use-my-segment-products && pnpm --filter @viu/emporix-sdk-react typecheck`
Expected: PASS, typecheck clean. If react branch coverage drops below
80%, the most likely uncovered branch is the disabled-when-logged-out
path on the infinite hook — add a focused test asserting
`fetchStatus === "idle"` with no token. Do not lower the threshold.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/hooks/use-my-segments.ts packages/react/src/hooks/index.ts \
  packages/react/src/index.ts packages/react/tests/use-my-segment-products.test.tsx
git commit -m "feat(react): useMySegmentProducts + useMySegmentProductsInfinite"
```

---

### Task 6: React hooks — `useMySegmentCategories` (single page + infinite)

**Files:**
- Modify: `packages/react/src/hooks/use-my-segments.ts`
- Modify: `packages/react/src/hooks/index.ts`, `packages/react/src/index.ts`
- Test: `packages/react/tests/use-my-segment-categories.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/react/tests/use-my-segment-categories.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import {
  useMySegmentCategories,
  useMySegmentCategoriesInfinite,
} from "../src/hooks/use-my-segments";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customer-segment/acme/segments/items", ({ request }) => {
    const pn = Number(new URL(request.url).searchParams.get("pageNumber") ?? "1");
    if (pn === 1) {
      return HttpResponse.json([
        { type: "CATEGORY", item: { id: "c1" } },
        { type: "CATEGORY", item: { id: "c2" } },
      ]);
    }
    if (pn === 2) {
      return HttpResponse.json([{ type: "CATEGORY", item: { id: "c3" } }]);
    }
    return HttpResponse.json([]);
  }),
  http.post(
    "https://api.emporix.io/category/acme/categories/search",
    async ({ request }) => {
      const body = (await request.json()) as { q?: string };
      const ids = (body.q ?? "")
        .replace(/^id:\(/, "")
        .replace(/\)$/, "")
        .split(",")
        .filter(Boolean);
      return HttpResponse.json(ids.map((id) => ({ id })));
    },
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

describe("useMySegmentCategories / Infinite", () => {
  it("single-page returns PaginatedItems<Category>", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    const { result } = renderHook(
      () => useMySegmentCategories({ pageSize: 2 }),
      { wrapper: wrap(storage) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items.map((c) => (c as { id?: string }).id)).toEqual([
      "c1",
      "c2",
    ]);
    expect(result.current.data?.hasNextPage).toBe(true);
  });

  it("infinite fetches pages with fetchNextPage", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    const { result } = renderHook(
      () => useMySegmentCategoriesInfinite({ pageSize: 2 }),
      { wrapper: wrap(storage) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    const all = (result.current.data?.pages ?? []).flatMap((p) => p.items);
    expect(all.map((c) => (c as { id?: string }).id)).toEqual(["c1", "c2", "c3"]);
    expect(result.current.hasNextPage).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @viu/emporix-sdk-react test -- use-my-segment-categories`
Expected: FAIL — neither hook is exported.

- [ ] **Step 3: Add the two category hooks**

In `packages/react/src/hooks/use-my-segments.ts`, append at the bottom
(below the product hooks added in Task 5):

```ts
declare const segmentsListMyCategories: (
  query?: unknown,
  auth?: unknown,
) => Promise<{
  items: unknown[];
  pageNumber: number;
  pageSize: number;
  hasNextPage: boolean;
}>;

/** Hydrated CATEGORY page for the caller's segments. */
export function useMySegmentCategories(
  query: {
    q?: string;
    siteCode?: string;
    legalEntityId?: string;
    onlyActive?: boolean;
    pageNumber?: number;
    pageSize?: number;
  } = {},
): UseQueryResult<Awaited<ReturnType<typeof segmentsListMyCategories>>> {
  const { client, storage } = useEmporix();
  const token = storage.getCustomerToken();
  return useQuery({
    queryKey: [
      "emporix",
      "segment",
      "myCategories",
      { tenant: client.tenant, query },
    ],
    enabled: token !== null,
    queryFn: () => client.segments.listMyCategories(query, customerCtx(token)),
  });
}

/** Hydrated CATEGORY pages — infinite scroll. */
export function useMySegmentCategoriesInfinite(
  query: {
    q?: string;
    siteCode?: string;
    legalEntityId?: string;
    onlyActive?: boolean;
    pageSize?: number;
  } = {},
): UseInfiniteQueryResult<
  {
    pages: Awaited<ReturnType<typeof segmentsListMyCategories>>[];
    pageParams: number[];
  },
  unknown
> {
  const { client, storage } = useEmporix();
  const token = storage.getCustomerToken();
  return useInfiniteQuery({
    queryKey: [
      "emporix",
      "segment",
      "myCategoriesInfinite",
      { tenant: client.tenant, query },
    ],
    enabled: token !== null,
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      client.segments.listMyCategories(
        { ...query, pageNumber: pageParam as number, pageSize: query.pageSize ?? 20 },
        customerCtx(token),
      ),
    getNextPageParam: (last) => (last.hasNextPage ? last.pageNumber + 1 : undefined),
  });
}
```

- [ ] **Step 4: Export the hooks**

In `packages/react/src/hooks/index.ts`, add the two new names to the
existing segment-hooks re-export block, so it reads:

```ts
export {
  useMySegments,
  useMySegmentItems,
  useMySegmentCategoryTree,
  useMySegmentProducts,
  useMySegmentProductsInfinite,
  useMySegmentCategories,
  useMySegmentCategoriesInfinite,
} from "./use-my-segments";
```

In `packages/react/src/index.ts`, add the same two names to the
`from "./hooks/index"` re-export block.

- [ ] **Step 5: Run tests + react typecheck**

Run: `pnpm build && pnpm --filter @viu/emporix-sdk-react test -- use-my-segment-categories && pnpm --filter @viu/emporix-sdk-react typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/hooks/use-my-segments.ts packages/react/src/hooks/index.ts \
  packages/react/src/index.ts packages/react/tests/use-my-segment-categories.test.tsx
git commit -m "feat(react): useMySegmentCategories + useMySegmentCategoriesInfinite"
```

---

### Task 7: Docs + changeset + green gate + finish

**Files:**
- Modify: `docs/segments.md` (append a Pagination section)
- Create: `.changeset/segment-hydrate-bulk.md`

- [ ] **Step 1: Append a pagination section to `docs/segments.md`**

In `docs/segments.md`, append at the end of the file (after the
existing **Out of scope** section, OR before it — whichever the
current file structure makes cleaner; the existing file ends with an
"Out of scope" list, so insert the new section directly above it):

```markdown
## Pagination

The hydrate helpers and their React hooks page through the customer's
segment items: each page is `pageSize` segment-item rows (PRODUCT or
CATEGORY), and `hasNextPage` is `true` when the source page is full.
Hydration is a single bulk call per page (`POST /<service>/{tenant}/<resource>/search`
with `q="id:(…)"`), so a page of 20 products costs **one** product
round-trip — not 20.

```ts
const page = await client.segments.listMyProducts(
  { pageNumber: 1, pageSize: 20 },
  auth.customer(token),
);
// page: { items: Product[]; pageNumber: 1; pageSize: 20; hasNextPage: boolean }
```

The React hooks expose the same shape, plus an infinite-scroll variant:

```tsx
const q = useMySegmentProductsInfinite({ pageSize: 20 });
const products = q.data?.pages.flatMap((p) => p.items) ?? [];
return (
  <>
    {products.map(/* … */)}
    {q.hasNextPage && (
      <button onClick={() => q.fetchNextPage()}>Load more</button>
    )}
  </>
);
```

Same pair for categories: `useMySegmentCategories` /
`useMySegmentCategoriesInfinite`. The `hasNextPage` flag is derived
from the **source segment-items page** being full, not from the
hydrated `items` array — a page whose source rows are all
out-of-segment-type-after-filter still correctly advances. Edge case:
when the very last source page happens to be exactly `pageSize`
long, the next fetch returns an empty page and `hasNextPage` flips
to `false`; the infinite scroll terminates cleanly.
\`\`\`

(Replace the triple-backtick fences with their actual symbols when
copying — the escape above is for this plan document itself.)

- [ ] **Step 2: Add the changeset**

Create `.changeset/segment-hydrate-bulk.md`:

```markdown
---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Segment hydrate now uses a single Emporix `POST /search` per page
instead of N+1 `GET /products/{id}` calls. New
`ProductService.searchByIds(ids, { chunkSize? }, auth?)` and
`CategoryService.searchByIds(...)` POST `/search` with
`q="id:(id1,id2,…)"`, chunking at 100 IDs by default. Adds the generic
`PaginatedItems<T>` (`{ items, pageNumber, pageSize, hasNextPage }`) in
`core/context.ts`.

**BREAKING:** `SegmentService.listMyProducts` and
`SegmentService.listMyCategories` now return `PaginatedItems<Product>`
/ `PaginatedItems<Category>` instead of a flat `Product[]` /
`Category[]`. `SegmentService.listItems` gains optional `pageNumber` /
`pageSize` params (additive). `listMyProductIds` / `listMyCategoryIds`
are unchanged.

React adds four new hooks: `useMySegmentProducts` /
`useMySegmentProductsInfinite` and `useMySegmentCategories` /
`useMySegmentCategoriesInfinite`. The infinite variants use
`useInfiniteQuery` with a `pageNumber` cursor and `hasNextPage`-driven
`getNextPageParam`. All four are disabled when no customer token is in
storage.
```

- [ ] **Step 3: Full green gate**

Run:

```bash
pnpm build && pnpm typecheck && pnpm -r --filter "./packages/*" test
```

Expected: build ok; typecheck clean across sdk/react/examples; sdk +
react suites pass; coverage ≥80% on `packages/*`.

- [ ] **Step 4: Commit**

```bash
git add docs/segments.md .changeset/segment-hydrate-bulk.md
git commit -m "docs(segment): pagination section; add changeset"
```

- [ ] **Step 5: Finish the branch**

Use **superpowers:finishing-a-development-branch** (verify tests → 4-option menu → execute choice).

---

## Self-Review

- **Spec coverage:** §A `PaginatedItems<T>` → Task 1; §B `searchByIds`
  on Product → Task 2, Category → Task 3; §C `listItems` pagination +
  `listMyProducts`/`listMyCategories` refactor → Task 4; §D React
  product hooks → Task 5, category hooks → Task 6; release/docs §5 →
  Task 7. All four Decisions (1 `searchByIds` reusable, 2 breaking
  page-object return, 3 `PaginatedItems<T>` in `core/context.ts`, 4
  four hooks mirroring `useProducts`/`useProductsInfinite`) reflected.
- **Placeholder scan:** the `declare const` type helpers in Tasks 5 +
  6 are real, runtime-erased TypeScript constructs used to derive the
  hook return type from the SDK method's return shape without
  importing per-element types — they are not placeholders. All other
  code blocks are complete.
- **Type consistency:** `PaginatedItems<T>`, `searchByIds(ids,
  options?, auth?)` (consistent on Product + Category),
  `listMyProducts`/`listMyCategories` returning
  `PaginatedItems<Product>` / `PaginatedItems<Category>`,
  `listMyProductIds`/`listMyCategoryIds` returning `Promise<string[]>`,
  the four hook names + their queryKey discriminators
  (`myProducts`/`myProductsInfinite`/`myCategories`/`myCategoriesInfinite`)
  match across the SDK, React, tests, docs, and changeset.
