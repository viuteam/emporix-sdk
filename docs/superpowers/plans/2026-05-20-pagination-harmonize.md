# Pagination Harmonization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harmonize Product/Category list/search pagination to the `PaginatedItems<T>` contract already used by Segments — removing the broken `Page<T>` type (whose `total` was always `NaN`), fixing the fragile `useProductsInfinite` cursor, and adding the missing `useCategoriesInfinite` hook.

**Architecture:** Single shared pagination contract across the SDK: `{ items, pageNumber, pageSize, hasNextPage }` with `hasNextPage` derived from `items.length === pageSize`. React hooks use `useInfiniteQuery` with `getNextPageParam: (last) => last.hasNextPage ? last.pageNumber + 1 : undefined`. The HTTP-client header passthrough (`X-Total-Count`) is intentionally **not** in scope — `hasNextPage` covers infinite scroll, and absolute totals are unused by current consumers.

**Tech Stack:** TypeScript, native `fetch`, TanStack React Query v5, Vitest, pnpm workspaces (monorepo: `packages/sdk`, `packages/react`).

**Context for the engineer:**
- This is a **BREAKING** change for `client.products.list/search`, `client.categories.list/productsIn`, `useProducts`, `useCategories`, `useProductsInfinite`. Changeset must be `major`.
- The gold-standard pattern to mirror is `packages/react/src/hooks/use-my-segments.ts` (Segment hydration hooks).
- The gold-standard service pattern is `packages/sdk/src/services/segment.ts:179-218` (`listMyProducts`/`listMyCategories`).
- `PaginatedItems<T>` already exists in `packages/sdk/src/core/context.ts:27-32` — do not redefine it.
- After approval, **move this plan to** `docs/superpowers/plans/2026-05-20-pagination-harmonize.md` (repo convention).

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/sdk/src/core/context.ts` | Shared types & async-iter helper | Add `iterateAll`, remove `Page<T>` and `paginate()` (after Task 6) |
| `packages/sdk/src/services/product.ts` | Product reads | `list`/`search` return `PaginatedItems<Product>`; `listAll` uses `iterateAll` |
| `packages/sdk/src/services/category.ts` | Category reads | `list`/`productsIn` return `PaginatedItems<Category>`/`PaginatedItems<Product>`; `listAll` uses `iterateAll` |
| `packages/sdk/src/index.ts` | Public API | Remove `Page` export, keep `PaginatedItems` export (verify) |
| `packages/react/src/hooks/queries.ts` | Product/Category hooks | Switch return types, fix `useProductsInfinite`, add `useCategoriesInfinite` |
| `packages/sdk/tests/services/product.test.ts` | Product service tests | Update to `PaginatedItems` shape |
| `packages/sdk/tests/services/category.test.ts` | Category service tests | Update to `PaginatedItems` shape; add `productsIn` cases |
| `packages/sdk/tests/context.test.ts` | Helper tests | Replace `paginate` tests with `iterateAll` tests |
| `packages/react/tests/queries.test.tsx` | Product/Category hook tests | Update to `PaginatedItems` shape; cover infinite termination |
| `packages/react/tests/use-categories-infinite.test.tsx` | New hook tests | Mirror `use-my-segment-products.test.tsx` |
| `docs/pagination.md` | New doc page | Short shared-contract reference |
| `docs/segments.md` | Existing | Cross-link new page |
| `.changeset/pagination-harmonize.md` | Release notes | Major; BREAKING listed |

---

## Task 1: Add `iterateAll` helper (additive, non-breaking)

**Files:**
- Modify: `packages/sdk/src/core/context.ts`
- Test: `packages/sdk/tests/context.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/sdk/tests/context.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { iterateAll, type PaginatedItems } from "../src/core/context";

describe("iterateAll", () => {
  it("yields every item across pages and stops on hasNextPage=false", async () => {
    const pages: PaginatedItems<number>[] = [
      { items: [1, 2], pageNumber: 1, pageSize: 2, hasNextPage: true },
      { items: [3, 4], pageNumber: 2, pageSize: 2, hasNextPage: true },
      { items: [5], pageNumber: 3, pageSize: 2, hasNextPage: false },
    ];
    const calls: number[] = [];
    const fetch = (p: number) => {
      calls.push(p);
      return Promise.resolve(pages[p - 1]);
    };
    const out: number[] = [];
    for await (const n of iterateAll<number>(fetch)) out.push(n);
    expect(out).toEqual([1, 2, 3, 4, 5]);
    expect(calls).toEqual([1, 2, 3]);
  });

  it("respects a custom start page", async () => {
    const fetch = (p: number) =>
      Promise.resolve<PaginatedItems<string>>({
        items: [`p${p}`],
        pageNumber: p,
        pageSize: 1,
        hasNextPage: false,
      });
    const out: string[] = [];
    for await (const s of iterateAll<string>(fetch, 5)) out.push(s);
    expect(out).toEqual(["p5"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk test -- context.test`
Expected: FAIL with `iterateAll is not exported from "../src/core/context"` or similar.

- [ ] **Step 3: Add `iterateAll` to `core/context.ts`**

Append to `packages/sdk/src/core/context.ts` (do NOT yet remove `Page<T>` or `paginate` — that's Task 6):

```typescript
/**
 * Async-iterates every item across pages of a `PaginatedItems<T>` source.
 * Stops when the source reports `hasNextPage: false`.
 *
 * @param fetchPage - given a 1-based page number, returns the page.
 * @param start - first page to fetch (default `1`).
 */
export async function* iterateAll<T>(
  fetchPage: (pageNumber: number) => Promise<PaginatedItems<T>>,
  start = 1,
): AsyncIterable<T> {
  let p = start;
  for (;;) {
    const page = await fetchPage(p);
    for (const it of page.items) yield it;
    if (!page.hasNextPage) return;
    p += 1;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk test -- context.test`
Expected: PASS — both `iterateAll` tests green; pre-existing `paginate` tests still green.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/core/context.ts packages/sdk/tests/context.test.ts
git commit -m "feat(core): add iterateAll async-iterator over PaginatedItems"
```

---

## Task 2: Migrate `ProductService.list` to `PaginatedItems<Product>`

**Files:**
- Modify: `packages/sdk/src/services/product.ts:50-63`
- Test: `packages/sdk/tests/services/product.test.ts`

- [ ] **Step 1: Update the failing test for `list`**

In `packages/sdk/tests/services/product.test.ts`, locate the `list` test(s) and replace assertions on `total`/`offset`/`limit` with `pageNumber`/`pageSize`/`hasNextPage`. Add the explicit `hasNextPage` cases. Example shape (adapt to existing test harness conventions):

```typescript
it("list returns PaginatedItems with hasNextPage=true when page is full", async () => {
  const items = Array.from({ length: 50 }, (_, i) => ({ id: `p${i}` }));
  const http = { request: vi.fn().mockResolvedValue(items) };
  const svc = new ProductService({ tenant: "viu", http, /* ...rest */ } as any);

  const page = await svc.list({ pageNumber: 1, pageSize: 50 });

  expect(page).toEqual({
    items,
    pageNumber: 1,
    pageSize: 50,
    hasNextPage: true,
  });
  expect(http.request).toHaveBeenCalledWith(
    expect.objectContaining({ query: { pageNumber: 1, pageSize: 50 } }),
  );
});

it("list returns hasNextPage=false when page is short", async () => {
  const items = [{ id: "p1" }, { id: "p2" }];
  const http = { request: vi.fn().mockResolvedValue(items) };
  const svc = new ProductService({ tenant: "viu", http, /* ...rest */ } as any);

  const page = await svc.list({ pageNumber: 1, pageSize: 50 });

  expect(page.hasNextPage).toBe(false);
  expect(page.items).toHaveLength(2);
});

it("list defaults pageNumber=1, pageSize=50", async () => {
  const http = { request: vi.fn().mockResolvedValue([]) };
  const svc = new ProductService({ tenant: "viu", http, /* ...rest */ } as any);
  await svc.list();
  expect(http.request).toHaveBeenCalledWith(
    expect.objectContaining({ query: { pageNumber: 1, pageSize: 50 } }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk test -- product.test`
Expected: FAIL — `list` still returns `{ items, total: NaN, offset, limit }`.

- [ ] **Step 3: Replace `list` implementation**

In `packages/sdk/src/services/product.ts`, replace lines 50-63:

```typescript
/** One page of products. */
async list(
  params: { pageNumber?: number; pageSize?: number } = {},
  auth: AuthContext = ANON,
): Promise<PaginatedItems<Product>> {
  const pageNumber = params.pageNumber ?? 1;
  const pageSize = params.pageSize ?? 50;
  const items = await this.ctx.http.request<Product[]>({
    method: "GET",
    path: `/product/${this.ctx.tenant}/products`,
    query: { pageNumber, pageSize },
    auth,
  });
  return { items, pageNumber, pageSize, hasNextPage: items.length === pageSize };
}
```

Also update the top-of-file import:

```typescript
import type { ClientContext, PaginatedItems } from "../core/context";
```

(remove the `Page` import; `paginate` still needed for `listAll` until Task 2 sub-step below).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk test -- product.test`
Expected: PASS for `list` tests. `search` and `listAll` tests may still fail — fixed in next steps.

- [ ] **Step 5: Update `search` test, then implementation**

Add/update test in `product.test.ts`:

```typescript
it("search returns PaginatedItems with hasNextPage", async () => {
  const items = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}` }));
  const http = { request: vi.fn().mockResolvedValue(items) };
  const svc = new ProductService({ tenant: "viu", http, /* ...rest */ } as any);
  const page = await svc.search("name:Foo", { pageNumber: 2, pageSize: 20 });
  expect(page).toEqual({ items, pageNumber: 2, pageSize: 20, hasNextPage: true });
  expect(http.request).toHaveBeenCalledWith(
    expect.objectContaining({ query: { q: "name:Foo", pageNumber: 2, pageSize: 20 } }),
  );
});
```

Run: `pnpm -F @viu/emporix-sdk test -- product.test` — expect FAIL on `search`.

Replace `search` (current `product.ts:76-90`):

```typescript
/** Searches products by free-text query. */
async search(
  query: string,
  params: { pageNumber?: number; pageSize?: number } = {},
  auth: AuthContext = ANON,
): Promise<PaginatedItems<Product>> {
  const pageNumber = params.pageNumber ?? 1;
  const pageSize = params.pageSize ?? 50;
  const items = await this.ctx.http.request<Product[]>({
    method: "GET",
    path: `/product/${this.ctx.tenant}/products`,
    query: { q: query, pageNumber, pageSize },
    auth,
  });
  return { items, pageNumber, pageSize, hasNextPage: items.length === pageSize };
}
```

Run: `pnpm -F @viu/emporix-sdk test -- product.test` — expect PASS on `search`.

- [ ] **Step 6: Update `listAll` to use `iterateAll`**

Test (append to `product.test.ts`):

```typescript
it("listAll iterates across pages until hasNextPage=false", async () => {
  const pages = [
    Array.from({ length: 50 }, (_, i) => ({ id: `p${i}` })),
    Array.from({ length: 50 }, (_, i) => ({ id: `p${i + 50}` })),
    [{ id: "p100" }],
  ];
  const http = { request: vi.fn() };
  pages.forEach((p) => http.request.mockResolvedValueOnce(p));
  const svc = new ProductService({ tenant: "viu", http, /* ...rest */ } as any);

  const out: Product[] = [];
  for await (const p of svc.listAll({ pageSize: 50 })) out.push(p);

  expect(out).toHaveLength(101);
  expect(http.request).toHaveBeenCalledTimes(3);
});
```

Run: expect FAIL (old `paginate` path returns `Page<Product>`, no longer matches).

Replace `listAll` (current `product.ts:65-73`):

```typescript
/** Async-iterates every product across pages. */
listAll(params: { pageSize?: number } = {}, auth: AuthContext = ANON): AsyncIterable<Product> {
  const pageSize = params.pageSize ?? 50;
  return iterateAll<Product>((pageNumber) => this.list({ pageNumber, pageSize }, auth));
}
```

Update imports at top of `product.ts`:

```typescript
import type { ClientContext, PaginatedItems } from "../core/context";
import { iterateAll } from "../core/context";
```

(Remove `paginate` and `Page` imports.)

Run: `pnpm -F @viu/emporix-sdk test -- product.test` — expect ALL PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/services/product.ts packages/sdk/tests/services/product.test.ts
git commit -m "feat(product)!: list/search/listAll return PaginatedItems"
```

---

## Task 3: Migrate `CategoryService.list` and `productsIn` to `PaginatedItems`

**Files:**
- Modify: `packages/sdk/src/services/category.ts:29-79`
- Test: `packages/sdk/tests/services/category.test.ts`

- [ ] **Step 1: Update `list` tests**

In `packages/sdk/tests/services/category.test.ts` adapt assertions analogously to Task 2 Step 1. Use the same hasNextPage true/false pattern:

```typescript
it("list returns PaginatedItems<Category>", async () => {
  const items = Array.from({ length: 50 }, (_, i) => ({ id: `c${i}` }));
  const http = { request: vi.fn().mockResolvedValue(items) };
  const svc = new CategoryService({ tenant: "viu", http, /* ...rest */ } as any);
  const page = await svc.list({ pageNumber: 1, pageSize: 50 });
  expect(page).toEqual({ items, pageNumber: 1, pageSize: 50, hasNextPage: true });
});

it("list reports hasNextPage=false on short pages", async () => {
  const http = { request: vi.fn().mockResolvedValue([{ id: "c1" }]) };
  const svc = new CategoryService({ tenant: "viu", http, /* ...rest */ } as any);
  const page = await svc.list({ pageNumber: 1, pageSize: 50 });
  expect(page.hasNextPage).toBe(false);
});
```

- [ ] **Step 2: Run tests, expect failure**

Run: `pnpm -F @viu/emporix-sdk test -- category.test`
Expected: FAIL.

- [ ] **Step 3: Replace `list` implementation**

In `packages/sdk/src/services/category.ts` lines 29-42:

```typescript
/** One page of categories. */
async list(
  params: { pageNumber?: number; pageSize?: number } = {},
  auth: AuthContext = ANON,
): Promise<PaginatedItems<Category>> {
  const pageNumber = params.pageNumber ?? 1;
  const pageSize = params.pageSize ?? 50;
  const items = await this.ctx.http.request<Category[]>({
    method: "GET",
    path: `/category/${this.ctx.tenant}/categories`,
    query: { pageNumber, pageSize },
    auth,
  });
  return { items, pageNumber, pageSize, hasNextPage: items.length === pageSize };
}
```

Imports at top of file:

```typescript
import type { ClientContext, PaginatedItems } from "../core/context";
import { iterateAll } from "../core/context";
```

(Remove `Page` and `paginate`.)

- [ ] **Step 4: Add test for `productsIn`**

```typescript
it("productsIn returns PaginatedItems<Product>", async () => {
  const items = Array.from({ length: 50 }, (_, i) => ({ id: `p${i}` }));
  const http = { request: vi.fn().mockResolvedValue(items) };
  const svc = new CategoryService({ tenant: "viu", http, /* ...rest */ } as any);
  const page = await svc.productsIn("cat-1", { pageNumber: 1, pageSize: 50 });
  expect(page).toEqual({ items, pageNumber: 1, pageSize: 50, hasNextPage: true });
  expect(http.request).toHaveBeenCalledWith(
    expect.objectContaining({
      path: "/category/viu/categories/cat-1/products",
      query: { pageNumber: 1, pageSize: 50 },
    }),
  );
});
```

- [ ] **Step 5: Replace `productsIn` implementation**

In `packages/sdk/src/services/category.ts` lines 64-79:

```typescript
/** One page of products in a category. */
async productsIn(
  categoryId: string,
  params: { pageNumber?: number; pageSize?: number } = {},
  auth: AuthContext = ANON,
): Promise<PaginatedItems<Product>> {
  const pageNumber = params.pageNumber ?? 1;
  const pageSize = params.pageSize ?? 50;
  const items = await this.ctx.http.request<Product[]>({
    method: "GET",
    path: `/category/${this.ctx.tenant}/categories/${categoryId}/products`,
    query: { pageNumber, pageSize },
    auth,
  });
  return { items, pageNumber, pageSize, hasNextPage: items.length === pageSize };
}
```

- [ ] **Step 6: Replace `listAll`**

Test:

```typescript
it("listAll iterates categories across pages", async () => {
  const pages = [
    Array.from({ length: 50 }, (_, i) => ({ id: `c${i}` })),
    [{ id: "c50" }],
  ];
  const http = { request: vi.fn() };
  pages.forEach((p) => http.request.mockResolvedValueOnce(p));
  const svc = new CategoryService({ tenant: "viu", http, /* ...rest */ } as any);
  const out: Category[] = [];
  for await (const c of svc.listAll({ pageSize: 50 })) out.push(c);
  expect(out).toHaveLength(51);
  expect(http.request).toHaveBeenCalledTimes(2);
});
```

Replace `listAll` (lines 44-52):

```typescript
/** Async-iterates every category across pages. */
listAll(params: { pageSize?: number } = {}, auth: AuthContext = ANON): AsyncIterable<Category> {
  const pageSize = params.pageSize ?? 50;
  return iterateAll<Category>((pageNumber) => this.list({ pageNumber, pageSize }, auth));
}
```

- [ ] **Step 7: Run all category tests, expect PASS**

Run: `pnpm -F @viu/emporix-sdk test -- category.test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/sdk/src/services/category.ts packages/sdk/tests/services/category.test.ts
git commit -m "feat(category)!: list/productsIn/listAll return PaginatedItems"
```

---

## Task 4: Refactor `useProducts*` and `useCategories` hooks; fix infinite cursor

**Files:**
- Modify: `packages/react/src/hooks/queries.ts`
- Test: `packages/react/tests/queries.test.tsx`

- [ ] **Step 1: Update the failing tests in `queries.test.tsx`**

Find existing `useProducts`, `useProductsInfinite`, `useCategories` tests and update assertions. Add a test that specifically verifies `useProductsInfinite` does **not** over-fetch a trailing empty page:

```typescript
it("useProductsInfinite terminates on hasNextPage=false without a trailing empty fetch", async () => {
  const listSpy = vi.fn();
  listSpy
    .mockResolvedValueOnce({ items: [{ id: "p1" }, { id: "p2" }], pageNumber: 1, pageSize: 2, hasNextPage: true })
    .mockResolvedValueOnce({ items: [{ id: "p3" }], pageNumber: 2, pageSize: 2, hasNextPage: false });
  // wire up client mock with products.list = listSpy
  const { result } = renderHook(() => useProductsInfinite({ pageSize: 2 }), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  await act(async () => { await result.current.fetchNextPage(); });
  await waitFor(() => expect(result.current.hasNextPage).toBe(false));
  expect(listSpy).toHaveBeenCalledTimes(2); // not 3
});

it("useProducts returns PaginatedItems<Product>", async () => {
  const list = vi.fn().mockResolvedValue({
    items: [{ id: "p1" }],
    pageNumber: 1,
    pageSize: 50,
    hasNextPage: false,
  });
  // wire client mock with products.list = list
  const { result } = renderHook(() => useProducts(), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data).toEqual({
    items: [{ id: "p1" }],
    pageNumber: 1,
    pageSize: 50,
    hasNextPage: false,
  });
});
```

(Adapt to the existing test harness — `wrapper`, mock-client setup, etc. follow whatever `queries.test.tsx` already does.)

- [ ] **Step 2: Run, expect failure**

Run: `pnpm -F @viu/emporix-react test -- queries.test`
Expected: FAIL.

- [ ] **Step 3: Replace hooks in `queries.ts`**

In `packages/react/src/hooks/queries.ts`, replace the entire file content with:

```typescript
import {
  useQuery,
  useInfiniteQuery,
  type UseQueryResult,
  type UseInfiniteQueryResult,
} from "@tanstack/react-query";
import {
  auth,
  type AuthContext,
  type Product,
  type Category,
  type CategoryNode,
  type Cart,
  type PaginatedItems,
} from "@viu/emporix-sdk";
import { useEmporix } from "../provider";

interface QueryOpts {
  auth?: AuthContext;
}

function useReadAuth(override?: AuthContext): { ctx: AuthContext; kind: string } {
  const { storage } = useEmporix();
  if (override) return { ctx: override, kind: override.kind };
  const token = storage.getCustomerToken();
  return token
    ? { ctx: auth.customer(token), kind: "customer" }
    : { ctx: auth.anonymous(), kind: "anonymous" };
}

/** Fetches one product. Default auth: customer if logged in, else anonymous. */
export function useProduct(productId: string, options: QueryOpts = {}): UseQueryResult<Product> {
  const { client } = useEmporix();
  const { ctx, kind } = useReadAuth(options.auth);
  return useQuery({
    queryKey: ["emporix", "product", productId, { tenant: client.tenant, authKind: kind }],
    queryFn: () => client.products.get(productId, undefined, ctx),
  });
}

/** Fetches one page of products. */
export function useProducts(
  params: { pageNumber?: number; pageSize?: number } = {},
  options: QueryOpts = {},
): UseQueryResult<PaginatedItems<Product>> {
  const { client } = useEmporix();
  const { ctx, kind } = useReadAuth(options.auth);
  return useQuery({
    queryKey: ["emporix", "products", params, { tenant: client.tenant, authKind: kind }],
    queryFn: () => client.products.list(params, ctx),
  });
}

/** Infinite product list — terminates on `hasNextPage=false`. */
export function useProductsInfinite(
  params: { pageSize?: number } = {},
  options: QueryOpts = {},
): UseInfiniteQueryResult<{ pages: PaginatedItems<Product>[]; pageParams: number[] }> {
  const { client } = useEmporix();
  const { ctx, kind } = useReadAuth(options.auth);
  return useInfiniteQuery({
    queryKey: ["emporix", "products-infinite", params, { tenant: client.tenant, authKind: kind }],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      client.products.list(
        params.pageSize !== undefined
          ? { pageNumber: pageParam as number, pageSize: params.pageSize }
          : { pageNumber: pageParam as number },
        ctx,
      ),
    getNextPageParam: (last: PaginatedItems<Product>) =>
      last.hasNextPage ? last.pageNumber + 1 : undefined,
  });
}

/** Fetches one category. */
export function useCategory(
  categoryId: string,
  options: QueryOpts = {},
): UseQueryResult<Category> {
  const { client } = useEmporix();
  const { ctx, kind } = useReadAuth(options.auth);
  return useQuery({
    queryKey: ["emporix", "category", categoryId, { tenant: client.tenant, authKind: kind }],
    queryFn: () => client.categories.get(categoryId, ctx),
  });
}

/** Fetches one page of categories. */
export function useCategories(
  params: { pageNumber?: number; pageSize?: number } = {},
  options: QueryOpts = {},
): UseQueryResult<PaginatedItems<Category>> {
  const { client } = useEmporix();
  const { ctx, kind } = useReadAuth(options.auth);
  return useQuery({
    queryKey: ["emporix", "categories", params, { tenant: client.tenant, authKind: kind }],
    queryFn: () => client.categories.list(params, ctx),
  });
}

/** Infinite category list — terminates on `hasNextPage=false`. */
export function useCategoriesInfinite(
  params: { pageSize?: number } = {},
  options: QueryOpts = {},
): UseInfiniteQueryResult<{ pages: PaginatedItems<Category>[]; pageParams: number[] }> {
  const { client } = useEmporix();
  const { ctx, kind } = useReadAuth(options.auth);
  return useInfiniteQuery({
    queryKey: ["emporix", "categories-infinite", params, { tenant: client.tenant, authKind: kind }],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      client.categories.list(
        params.pageSize !== undefined
          ? { pageNumber: pageParam as number, pageSize: params.pageSize }
          : { pageNumber: pageParam as number },
        ctx,
      ),
    getNextPageParam: (last: PaginatedItems<Category>) =>
      last.hasNextPage ? last.pageNumber + 1 : undefined,
  });
}

/** Fetches the category tree. */
export function useCategoryTree(
  rootId?: string,
  options: QueryOpts = {},
): UseQueryResult<CategoryNode> {
  const { client } = useEmporix();
  const { ctx, kind } = useReadAuth(options.auth);
  return useQuery({
    queryKey: [
      "emporix",
      "category-tree",
      rootId ?? null,
      { tenant: client.tenant, authKind: kind },
    ],
    queryFn: () => client.categories.tree(rootId, ctx),
  });
}

/** Fetches a cart by id. Disabled when `cartId` is undefined. */
export function useCart(cartId?: string, options: QueryOpts = {}): UseQueryResult<Cart> {
  const { client, storage } = useEmporix();
  const override = options.auth;
  const token = storage.getCustomerToken();
  const ctx: AuthContext = override ?? (token ? auth.customer(token) : auth.anonymous());
  return useQuery({
    queryKey: ["emporix", "cart", cartId ?? null, { tenant: client.tenant, authKind: ctx.kind }],
    enabled: cartId !== undefined,
    queryFn: () => client.carts.get(cartId as string, ctx),
  });
}
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `pnpm -F @viu/emporix-react test -- queries.test`
Expected: PASS for all updated cases including the no-trailing-empty-fetch case.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/hooks/queries.ts packages/react/tests/queries.test.tsx
git commit -m "feat(react)!: useProducts/useCategories return PaginatedItems; fix infinite cursor"
```

---

## Task 5: Add dedicated `useCategoriesInfinite` test file

**Files:**
- Create: `packages/react/tests/use-categories-infinite.test.tsx`

- [ ] **Step 1: Create the test file**

Mirror `packages/react/tests/use-my-segment-products.test.tsx` structure. Concrete content:

```typescript
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useCategoriesInfinite } from "../src/hooks/queries";
// Reuse the same wrapper/mock-client helpers used by queries.test.tsx
import { makeWrapper, makeMockClient } from "./helpers/mocks";

describe("useCategoriesInfinite", () => {
  it("fetches page 1, then page 2 via fetchNextPage", async () => {
    const list = vi.fn();
    list
      .mockResolvedValueOnce({
        items: [{ id: "c1" }, { id: "c2" }],
        pageNumber: 1,
        pageSize: 2,
        hasNextPage: true,
      })
      .mockResolvedValueOnce({
        items: [{ id: "c3" }],
        pageNumber: 2,
        pageSize: 2,
        hasNextPage: false,
      });
    const { wrapper } = makeWrapper({ client: makeMockClient({ categories: { list } }) });
    const { result } = renderHook(() => useCategoriesInfinite({ pageSize: 2 }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);
    await act(async () => { await result.current.fetchNextPage(); });
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    expect(list).toHaveBeenCalledTimes(2);
    expect(result.current.data?.pages.flatMap((p) => p.items).map((c) => c.id)).toEqual([
      "c1", "c2", "c3",
    ]);
  });

  it("does not fetch a trailing empty page when hasNextPage=false on the last full page", async () => {
    const list = vi.fn();
    list
      .mockResolvedValueOnce({
        items: [{ id: "c1" }, { id: "c2" }],
        pageNumber: 1,
        pageSize: 2,
        hasNextPage: false,
      });
    const { wrapper } = makeWrapper({ client: makeMockClient({ categories: { list } }) });
    const { result } = renderHook(() => useCategoriesInfinite({ pageSize: 2 }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(false);
    expect(list).toHaveBeenCalledTimes(1);
  });
});
```

> **Note:** If `./helpers/mocks` doesn't exist with those exact exports, copy the wrapper/mock construction inline from `queries.test.tsx` instead. Do NOT change the public test helpers in this task.

- [ ] **Step 2: Run new tests, expect PASS**

Run: `pnpm -F @viu/emporix-react test -- use-categories-infinite`
Expected: PASS — `useCategoriesInfinite` already exists (Task 4), and these tests exercise it.

- [ ] **Step 3: Commit**

```bash
git add packages/react/tests/use-categories-infinite.test.tsx
git commit -m "test(react): add useCategoriesInfinite tests"
```

---

## Task 6: Remove `Page<T>` and `paginate()` from public API

**Files:**
- Modify: `packages/sdk/src/core/context.ts`
- Modify: `packages/sdk/src/index.ts` (verify exports)
- Modify: `packages/sdk/tests/context.test.ts` (drop old `paginate` tests)

- [ ] **Step 1: Verify nothing else imports `Page` or `paginate`**

Run: `git grep -nE "\b(Page<|paginate\()" packages/`
Expected: no matches except the file you're about to edit and its test file.

If any other consumer is found (e.g. a doc snippet, example app), fix it inline using `PaginatedItems<T>` / `iterateAll` — do NOT proceed past this step until grep is clean for source files.

- [ ] **Step 2: Drop the old tests and code**

In `packages/sdk/tests/context.test.ts`, delete the `describe("paginate", ...)` block (keep the `iterateAll` block from Task 1).

In `packages/sdk/src/core/context.ts`, remove lines 14-19 (`Page<T>`) and lines 41-54 (the `paginate` function). The file should now contain: `ClientContext`, `PaginatedItems<T>`, `DefaultAuth`, `iterateAll`. Final state:

```typescript
import type { HttpClient } from "./http";
import type { TokenProvider, AuthContext } from "./auth";
import type { Logger } from "./logger";

/** Shared dependencies every service facade receives. */
export interface ClientContext {
  tenant: string;
  http: HttpClient;
  tokenProvider: TokenProvider;
  logger: Logger;
}

/**
 * A cursor-paged collection — `pageNumber`/`pageSize` indexing with a
 * `hasNextPage` signal driven by the source page being full. Used by all
 * paginated services and hooks across the SDK.
 */
export interface PaginatedItems<T> {
  items: T[];
  pageNumber: number;
  pageSize: number;
  hasNextPage: boolean;
}

/** Default `AuthContext` applied by a service when the caller passes none. */
export type DefaultAuth = AuthContext | undefined;

/**
 * Async-iterates every item across pages of a `PaginatedItems<T>` source.
 * Stops when the source reports `hasNextPage: false`.
 */
export async function* iterateAll<T>(
  fetchPage: (pageNumber: number) => Promise<PaginatedItems<T>>,
  start = 1,
): AsyncIterable<T> {
  let p = start;
  for (;;) {
    const page = await fetchPage(p);
    for (const it of page.items) yield it;
    if (!page.hasNextPage) return;
    p += 1;
  }
}
```

- [ ] **Step 3: Verify public re-exports**

Open `packages/sdk/src/index.ts`. Confirm:
- `Page` is **not** re-exported.
- `paginate` is **not** re-exported.
- `PaginatedItems` **is** re-exported.
- `iterateAll` is re-exported if it was meant to be public (mirror the previous `paginate` export decision — if it was public, export `iterateAll`; if it was internal-only, keep both internal).

- [ ] **Step 4: Run full SDK + React build + tests**

Run:
```
pnpm -F @viu/emporix-sdk build
pnpm -F @viu/emporix-react build
pnpm -F @viu/emporix-sdk test
pnpm -F @viu/emporix-react test
```
Expected: ALL PASS. Any compile error means a consumer still uses `Page<T>`/`paginate` — fix at the call site (most likely an example app or test helper missed in Step 1).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/core/context.ts packages/sdk/src/index.ts packages/sdk/tests/context.test.ts
git commit -m "refactor(core)!: remove Page<T> and paginate; PaginatedItems is the sole contract"
```

---

## Task 7: Documentation and changeset

**Files:**
- Create: `docs/pagination.md`
- Modify: `docs/segments.md`
- Create: `.changeset/pagination-harmonize.md`

- [ ] **Step 1: Write `docs/pagination.md`**

```markdown
# Pagination

The SDK uses a single pagination contract across all list/search endpoints and hooks:

```ts
interface PaginatedItems<T> {
  items: T[];
  pageNumber: number;   // 1-based, matches Emporix
  pageSize: number;
  hasNextPage: boolean; // true when items.length === pageSize
}
```

## Single page (`useQuery`)

```tsx
const { data } = useProducts({ pageNumber: 1, pageSize: 50 });
// data: PaginatedItems<Product>
```

## Infinite scroll (`useInfiniteQuery`)

```tsx
const {
  data,           // { pages: PaginatedItems<Product>[]; pageParams: number[] }
  fetchNextPage,
  hasNextPage,
} = useProductsInfinite({ pageSize: 50 });

const allItems = data?.pages.flatMap((p) => p.items) ?? [];
```

Cursor logic: `getNextPageParam: (last) => last.hasNextPage ? last.pageNumber + 1 : undefined`. No trailing empty fetch; termination is signalled by the last full page reporting `hasNextPage: false`.

## Iterating every item (server-side / SSR)

```ts
for await (const product of client.products.listAll({ pageSize: 100 })) {
  // …
}
```

## Available paginated surfaces

| Service / Hook | Return type |
|---|---|
| `client.products.list/search/listAll` | `PaginatedItems<Product>` / `AsyncIterable<Product>` |
| `client.categories.list/productsIn/listAll` | `PaginatedItems<Category>` / `PaginatedItems<Product>` |
| `client.segments.listMyProducts/listMyCategories` | `PaginatedItems<Product/Category>` |
| `useProducts`, `useProductsInfinite` | `PaginatedItems<Product>` |
| `useCategories`, `useCategoriesInfinite` | `PaginatedItems<Category>` |
| `useMySegmentProducts`, `useMySegmentProductsInfinite` | `PaginatedItems<Product>` |
| `useMySegmentCategories`, `useMySegmentCategoriesInfinite` | `PaginatedItems<Category>` |

## Why not absolute totals?

Emporix returns `X-Total-Count` headers on some endpoints, but the SDK does not currently expose response headers to facades. `hasNextPage` covers infinite scroll cleanly; absolute totals (for "X of Y" UIs) will be added when there's a concrete consumer that needs them.
```

- [ ] **Step 2: Cross-link from `docs/segments.md`**

In `docs/segments.md`, in the existing Pagination section, add at the top:

```markdown
> See [Pagination](./pagination.md) for the shared `PaginatedItems<T>` contract that all SDK list endpoints follow.
```

- [ ] **Step 3: Write changeset**

Create `.changeset/pagination-harmonize.md`:

```markdown
---
"@viu/emporix-sdk": major
"@viu/emporix-react": major
---

Harmonize all paginated SDK surfaces on `PaginatedItems<T>`; remove `Page<T>` and `paginate()`.

**BREAKING**
- `client.products.list` and `client.products.search` now return `PaginatedItems<Product>` (`{ items, pageNumber, pageSize, hasNextPage }`) instead of `Page<Product>` (`{ items, total, offset, limit }`).
- `client.categories.list` returns `PaginatedItems<Category>`; `client.categories.productsIn` returns `PaginatedItems<Product>`.
- `useProducts`/`useCategories` now resolve to `PaginatedItems<T>`.
- `Page<T>` and the `paginate()` async-iterator are removed from the public API; use `PaginatedItems<T>` and the new `iterateAll<T>` helper.

**Fixed**
- `useProductsInfinite` previously over-fetched a trailing empty page before terminating, and its `getNextPageParam` was tied to fetched-page count rather than the actual cursor. It now drives the cursor from `last.hasNextPage` / `last.pageNumber + 1`.

**Added**
- `useCategoriesInfinite` — mirrors `useProductsInfinite` for categories.
- `iterateAll<T>(fetchPage)` async-iterator over `PaginatedItems<T>`.

**Migration**
```ts
// Before
const { items, total } = await client.products.list({ pageNumber: 1, pageSize: 50 });
// total was always NaN; remove it.

// After
const { items, hasNextPage } = await client.products.list({ pageNumber: 1, pageSize: 50 });
```
```

- [ ] **Step 4: Run docs build / lint if present**

If the repo has a docs build or lint step (check `package.json` scripts), run it. Otherwise skip.

- [ ] **Step 5: Commit**

```bash
git add docs/pagination.md docs/segments.md .changeset/pagination-harmonize.md
git commit -m "docs: pagination contract page; changeset for harmonization"
```

---

## Final Verification

- [ ] **Full monorepo green**

```bash
pnpm -w build
pnpm -w test
```
Expected: ALL PASS, no TypeScript errors.

- [ ] **Public-API surface check**

```bash
git grep -nE "\bPage<|\bpaginate\(" packages/ docs/ examples/ 2>/dev/null
```
Expected: no matches (only `PaginatedItems` and `iterateAll` remain).

- [ ] **Manual smoke (consuming app)**

In a storefront app that consumes the SDK:
1. Mount a component using `useProductsInfinite({ pageSize: 20 })`. Scroll. Confirm infinite scroll terminates on the last short page with **no extra empty HTTP request** in the Network panel.
2. Mount a component using `useCategoriesInfinite`. Same check.
3. Mount `useProducts({ pageNumber: 2, pageSize: 20 })`. Confirm `data` matches `PaginatedItems<Product>` (no `total`/`offset`/`limit`).

- [ ] **Changeset present**

```bash
ls .changeset/pagination-harmonize.md
```
Expected: file exists.

---

## Follow-up (out of scope)

- HTTP-client response-header passthrough so services can read `X-Total-Count`. Open a separate plan when a concrete UI surface needs absolute totals (e.g. progress bars or classic page-of-N navigation). Until then, `hasNextPage` is the contract.
- Order guarantee for `searchByIds` if consumers report needing it; currently documented as "order not guaranteed".
