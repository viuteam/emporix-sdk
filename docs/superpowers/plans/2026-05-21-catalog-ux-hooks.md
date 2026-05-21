# Catalog-UX Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four catalog-UX hooks to `@viu/emporix-sdk-react`: `useProductByCode`, `useProductSearch`, `useProductsInCategory`, `useProductsInCategoryInfinite`. Pure wrappers around existing SDK methods following the established `useReadAuth` + `enabled`-gate patterns.

**Tech Stack:** TypeScript, Vitest, MSW, TanStack React Query v5.

**Context for the engineer:**

- Read the spec first: `docs/superpowers/specs/2026-05-21-catalog-ux-hooks-design.md`.
- Branch: `feat/catalog-ux-hooks` (already created).
- All hooks live in existing files (`use-products.ts` + `use-categories.ts`); no new files for the hooks themselves.
- Commitlint scopes: `react`, `product`, `category`, `docs`. First word lowercase.
- Pre-commit hook runs typecheck + lint + tests.

---

## File Structure

| File | Change |
|---|---|
| `packages/react/src/hooks/use-products.ts` | Add `useProductByCode`, `useProductSearch` |
| `packages/react/src/hooks/use-categories.ts` | Add `useProductsInCategory`, `useProductsInCategoryInfinite` |
| `packages/react/src/hooks/index.ts` | Re-export 4 new symbols |
| `packages/react/src/index.ts` | Re-export 4 new symbols at root |
| `packages/react/tests/use-products.test.tsx` | Add 4 tests |
| `packages/react/tests/use-categories.test.tsx` | Add 4 tests |
| `.changeset/catalog-ux-hooks.md` | Minor changeset |
| `docs/react.md` | Document 4 new hooks |

---

## Task 1: `useProductByCode` + `useProductSearch` with tests

**Files:**
- Modify: `packages/react/src/hooks/use-products.ts`
- Modify: `packages/react/tests/use-products.test.tsx`

- [ ] **Step 1: Write failing tests**

Append to `packages/react/tests/use-products.test.tsx`:

```typescript
import { useProductByCode, useProductSearch } from "../src/hooks/use-products";

describe("useProductByCode", () => {
  it("is disabled when code is undefined", () => {
    const { result } = renderHook(() => useProductByCode(undefined), { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("fetches the product by code", async () => {
    server.use(
      http.get("https://api.emporix.io/product/acme/products", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("q")).toBe("code:T-SHIRT");
        return HttpResponse.json([{ id: "p1", code: "T-SHIRT", name: "Shirt" }]);
      }),
    );
    const { result } = renderHook(() => useProductByCode("T-SHIRT"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.data?.code).toBe("T-SHIRT"));
  });
});

describe("useProductSearch", () => {
  it("is disabled on empty query", () => {
    const { result } = renderHook(() => useProductSearch(""), { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("forwards query and pagination params", async () => {
    let seenQuery: URLSearchParams | undefined;
    server.use(
      http.get("https://api.emporix.io/product/acme/products", ({ request }) => {
        seenQuery = new URL(request.url).searchParams;
        return HttpResponse.json([{ id: "p1" }, { id: "p2" }]);
      }),
    );
    const { result } = renderHook(
      () => useProductSearch("shirt", { pageNumber: 1, pageSize: 10 }),
      { wrapper: wrap() },
    );
    await waitFor(() => expect(result.current.data?.items?.length).toBe(2));
    expect(seenQuery?.get("q")).toBe("shirt");
    expect(seenQuery?.get("pageSize")).toBe("10");
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
pnpm -F @viu/emporix-sdk-react test -- use-products
```

Expected: 4 new failures (module exports missing).

- [ ] **Step 3: Implement both hooks**

Append to `packages/react/src/hooks/use-products.ts`:

```typescript
/** Fetches one product by its `code` (URL slug). Disabled when code is empty. */
export function useProductByCode(
  code: string | undefined,
  options: QueryOpts = {},
): UseQueryResult<Product> {
  const { client } = useEmporix();
  const { ctx, kind } = useReadAuth(options.auth);
  return useQuery({
    queryKey: ["emporix", "product-by-code", code, { tenant: client.tenant, authKind: kind }],
    enabled: typeof code === "string" && code !== "",
    queryFn: () => client.products.getByCode(code as string, ctx),
  });
}

/** Full-text product search. Disabled when query is empty. */
export function useProductSearch(
  query: string | undefined,
  params: { pageNumber?: number; pageSize?: number } = {},
  options: QueryOpts = {},
): UseQueryResult<PaginatedItems<Product>> {
  const { client } = useEmporix();
  const { ctx, kind } = useReadAuth(options.auth);
  return useQuery({
    queryKey: [
      "emporix",
      "product-search",
      query,
      params,
      { tenant: client.tenant, authKind: kind },
    ],
    enabled: typeof query === "string" && query.trim() !== "",
    queryFn: () => client.products.search(query as string, params, ctx),
  });
}
```

Imports needed (verify they're already at the top): `useQuery`, `UseQueryResult`, `Product`, `PaginatedItems`, `useEmporix`, `useReadAuth`, `QueryOpts`.

- [ ] **Step 4: Run tests, expect PASS**

```bash
pnpm -F @viu/emporix-sdk build
pnpm -F @viu/emporix-sdk-react test -- use-products
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/hooks/use-products.ts packages/react/tests/use-products.test.tsx
git commit -m "feat(product): add useProductByCode and useProductSearch hooks"
```

---

## Task 2: `useProductsInCategory` + Infinite variant with tests

**Files:**
- Modify: `packages/react/src/hooks/use-categories.ts`
- Modify: `packages/react/tests/use-categories.test.tsx`

- [ ] **Step 1: Write failing tests**

Append to `packages/react/tests/use-categories.test.tsx`:

```typescript
import { act } from "@testing-library/react";
import {
  useProductsInCategory,
  useProductsInCategoryInfinite,
} from "../src/hooks/use-categories";

describe("useProductsInCategory", () => {
  it("is disabled without categoryId", () => {
    const { result } = renderHook(() => useProductsInCategory(undefined), {
      wrapper: wrap(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("GETs products by category id with pageSize", async () => {
    let seenQuery: URLSearchParams | undefined;
    server.use(
      http.get(
        "https://api.emporix.io/category/acme/categories/c1/products",
        ({ request }) => {
          seenQuery = new URL(request.url).searchParams;
          return HttpResponse.json([{ id: "p1" }, { id: "p2" }]);
        },
      ),
    );
    const { result } = renderHook(
      () => useProductsInCategory("c1", { pageSize: 12 }),
      { wrapper: wrap() },
    );
    await waitFor(() => expect(result.current.data?.items?.length).toBe(2));
    expect(seenQuery?.get("pageSize")).toBe("12");
  });
});

describe("useProductsInCategoryInfinite", () => {
  it("terminates on hasNextPage=false without trailing empty fetch", async () => {
    let calls = 0;
    server.use(
      http.get(
        "https://api.emporix.io/category/acme/categories/c1/products",
        ({ request }) => {
          calls += 1;
          const page = Number(new URL(request.url).searchParams.get("pageNumber") ?? "1");
          return page === 1
            ? HttpResponse.json([{ id: "p1" }, { id: "p2" }])
            : HttpResponse.json([{ id: "p3" }]);
        },
      ),
    );
    const { result } = renderHook(
      () => useProductsInCategoryInfinite("c1", { pageSize: 2 }),
      { wrapper: wrap() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    expect(calls).toBe(2);
    expect(
      result.current.data?.pages.flatMap((p) => p.items).map((p) => p.id),
    ).toEqual(["p1", "p2", "p3"]);
  });

  it("is disabled without categoryId", () => {
    const { result } = renderHook(() => useProductsInCategoryInfinite(undefined), {
      wrapper: wrap(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
pnpm -F @viu/emporix-sdk-react test -- use-categories
```

- [ ] **Step 3: Implement both hooks**

Append to `packages/react/src/hooks/use-categories.ts`:

```typescript
/** One page of products in a category. Disabled when categoryId is empty. */
export function useProductsInCategory(
  categoryId: string | undefined,
  params: { pageNumber?: number; pageSize?: number } = {},
  options: QueryOpts = {},
): UseQueryResult<PaginatedItems<Product>> {
  const { client } = useEmporix();
  const { ctx, kind } = useReadAuth(options.auth);
  return useQuery({
    queryKey: [
      "emporix",
      "products-in-category",
      categoryId,
      params,
      { tenant: client.tenant, authKind: kind },
    ],
    enabled: typeof categoryId === "string" && categoryId !== "",
    queryFn: () => client.categories.productsIn(categoryId as string, params, ctx),
  });
}

/** Infinite-scroll product list for a category. Terminates on `hasNextPage=false`. */
export function useProductsInCategoryInfinite(
  categoryId: string | undefined,
  params: { pageSize?: number } = {},
  options: QueryOpts = {},
): UseInfiniteQueryResult<{ pages: PaginatedItems<Product>[]; pageParams: number[] }> {
  const { client } = useEmporix();
  const { ctx, kind } = useReadAuth(options.auth);
  return useInfiniteQuery({
    queryKey: [
      "emporix",
      "products-in-category-infinite",
      categoryId,
      params,
      { tenant: client.tenant, authKind: kind },
    ],
    enabled: typeof categoryId === "string" && categoryId !== "",
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      client.categories.productsIn(
        categoryId as string,
        params.pageSize !== undefined
          ? { pageNumber: pageParam as number, pageSize: params.pageSize }
          : { pageNumber: pageParam as number },
        ctx,
      ),
    getNextPageParam: (last: PaginatedItems<Product>) =>
      last.hasNextPage ? last.pageNumber + 1 : undefined,
  });
}
```

Imports needed (verify): `useInfiniteQuery`, `UseInfiniteQueryResult`, `Product`. `useQuery`, `UseQueryResult`, `PaginatedItems` already imported.

- [ ] **Step 4: Run tests, expect PASS**

```bash
pnpm -F @viu/emporix-sdk build
pnpm -F @viu/emporix-sdk-react test -- use-categories
```

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/hooks/use-categories.ts packages/react/tests/use-categories.test.tsx
git commit -m "feat(category): add useProductsInCategory and infinite variant"
```

---

## Task 3: Re-exports

**Files:**
- Modify: `packages/react/src/hooks/index.ts`
- Modify: `packages/react/src/index.ts`

- [ ] **Step 1: Add to hooks/index.ts**

Replace the existing `use-products` and `use-categories` export lines to include the new symbols:

```typescript
export {
  useProduct,
  useProducts,
  useProductsInfinite,
  useProductByCode,
  useProductSearch,
} from "./use-products";
export {
  useCategory,
  useCategories,
  useCategoriesInfinite,
  useCategoryTree,
  useProductsInCategory,
  useProductsInCategoryInfinite,
} from "./use-categories";
```

- [ ] **Step 2: Add to src/index.ts**

Add to the hooks re-export list:

```typescript
  useProductByCode,
  useProductSearch,
  useProductsInCategory,
  useProductsInCategoryInfinite,
```

(Place near other product/category hooks.)

- [ ] **Step 3: Build + typecheck**

```bash
pnpm -F @viu/emporix-sdk-react build
pnpm typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/react/src/hooks/index.ts packages/react/src/index.ts
git commit -m "feat(react): export catalog-ux hooks from package root"
```

---

## Task 4: Docs + changeset

**Files:**
- Modify: `docs/react.md`
- Create: `.changeset/catalog-ux-hooks.md`

- [ ] **Step 1: Document new hooks in `docs/react.md`**

Add after the existing product-hooks section (or under a new "Catalog UX" subsection):

```markdown
### Catalog UX

`useProductByCode(code)` — fetches a product by its `code` field. Use for slug-based routes like `/products/[slug]`. Disabled when `code` is undefined/empty.

```tsx
const { data: product } = useProductByCode(params.slug);
```

`useProductSearch(query, params?)` — full-text search. Disabled on empty query — pair with consumer-side debouncing for header search boxes.

```tsx
const [q, setQ] = useState("");
const debounced = useDebounce(q, 300);
const { data } = useProductSearch(debounced, { pageSize: 10 });
```

`useProductsInCategory(categoryId, params?)` — paginated product list for a category page. `useProductsInCategoryInfinite` for infinite scroll, same `hasNextPage`-driven cursor as `useProductsInfinite`.

```tsx
const { data, fetchNextPage, hasNextPage } = useProductsInCategoryInfinite(categoryId, { pageSize: 24 });
const items = data?.pages.flatMap((p) => p.items) ?? [];
```
```

- [ ] **Step 2: Write the changeset**

Create `.changeset/catalog-ux-hooks.md`:

```markdown
---
"@viu/emporix-sdk-react": minor
---

Add four catalog-UX hooks to `@viu/emporix-sdk-react`:

- `useProductByCode(code)` — single-product lookup via the `code` field. For slug-based routes (`/products/[slug]`).
- `useProductSearch(query, params?)` — full-text product search. Disabled on empty query; pair with consumer-side debouncing.
- `useProductsInCategory(categoryId, params?)` — paginated products for a category landing page.
- `useProductsInCategoryInfinite(categoryId, params?)` — infinite-scroll variant of the same.

All four follow the established `useReadAuth` + `enabled`-gate patterns. No SDK change.
```

- [ ] **Step 3: Commit**

```bash
git add docs/react.md .changeset/catalog-ux-hooks.md
git commit -m "docs(docs): document and changeset catalog-ux hooks"
```

---

## Final Verification

- [ ] **Full repo build + test + typecheck**

```bash
pnpm -r build
pnpm -r test
pnpm typecheck
```

Expected: all green. React tests should grow by 8 — total 101.

- [ ] **All four hooks reachable from package root**

```bash
node -e "console.log(Object.keys(require('./packages/react/dist/index.cjs')).filter(k => /useProductBy|useProductSearch|useProductsInCategory/.test(k)).sort())"
```

Expected: `['useProductByCode', 'useProductSearch', 'useProductsInCategory', 'useProductsInCategoryInfinite']`.

- [ ] **E2E suite still green**

```bash
set -a; source e2e/.env.local; set +a
pnpm e2e
```

Expected: 6/6. The catalog-UX hooks aren't exercised by current E2E specs — they'd need a Catalog Example page that doesn't exist yet.

---

## Follow-up (out of scope)

- Slug-routed product page in `examples/vite-spa` demonstrating `useProductByCode` — separate UX iteration.
- Search-bar Example with debounce.
- Category landing page Example with `useProductsInCategoryInfinite`.
- E2E specs covering search + category-page once the Example surfaces exist.
- Faceted search hook when SDK exposes facets.
