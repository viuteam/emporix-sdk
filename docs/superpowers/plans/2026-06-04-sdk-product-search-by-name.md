# Phase 3 — `products.searchByName` + `useProductNameSearch` Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use `- [ ]`.

**Goal:** A free-text product-name search helper so consumers don't hand-build the Emporix `q` filter (the "No value for key …" 400 footgun the demo hit).

**Architecture:** `ProductService.searchByName(term)` escapes regex metacharacters, builds `name:(~<term>)`, and delegates to the existing raw-`q` `search`. A React `useProductNameSearch` hook wraps it. The storefront demo then drops its local `productSearchQuery` and uses the hook. Additive + non-breaking.

**Tech Stack:** TypeScript, Vitest + MSW, React Query.

**Spec:** `docs/superpowers/specs/2026-06-04-sdk-shape-normalization-design.md` (Phase 3 / Candidate 3).

---

## Task 1: SDK `ProductService.searchByName`

**Files:** Modify `packages/sdk/src/services/product.ts`; Test `packages/sdk/tests/services/product.test.ts`.

- [ ] **Step 1: Failing test** — append to `product.test.ts`:
```ts
describe("ProductService.searchByName", () => {
  it("builds a name:(~…) filter and escapes regex metacharacters", async () => {
    let seen: URLSearchParams | null = null;
    server.use(
      http.get("https://api.emporix.io/product/acme/products", ({ request }) => {
        seen = new URL(request.url).searchParams;
        return HttpResponse.json([{ id: "p1" }]);
      }),
    );
    await svc().searchByName("in time");
    expect((seen as URLSearchParams | null)?.get("q")).toBe("name:(~in time)");
    await svc().searchByName("a.b*(c)");
    expect((seen as URLSearchParams | null)?.get("q")).toBe("name:(~a\\.b\\*\\(c\\))");
  });
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm -F @viu/emporix-sdk test -- --run product` → FAIL (`searchByName` not a function).

- [ ] **Step 3: Implement** — in `product.ts`, directly after the `search` method:
```ts
  /**
   * Free-text product search by name. The product `q` is a `field:value` DSL,
   * so a bare term (e.g. "in time") 400s with "No value for key …". This builds
   * a `name:(~<term>)` regex filter (regex metacharacters escaped) and delegates
   * to {@link search}.
   */
  async searchByName(
    query: string,
    params: { pageNumber?: number; pageSize?: number } = {},
    auth: AuthContext = ANON,
  ): Promise<PaginatedItems<Product>> {
    const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return this.search(`name:(~${escaped})`, params, auth);
  }
```

- [ ] **Step 4: Run, verify pass** — `pnpm -F @viu/emporix-sdk test -- --run product` → PASS.

- [ ] **Step 5: Typecheck + commit**
```bash
pnpm -F @viu/emporix-sdk typecheck
git add packages/sdk/src/services/product.ts packages/sdk/tests/services/product.test.ts
git commit -m "feat(product): add searchByName free-text helper"
```

---

## Task 2: React `useProductNameSearch`

**Files:** Modify `packages/react/src/hooks/use-products.ts`, `packages/react/src/hooks/index.ts`; Test `packages/react/tests/use-products.test.tsx`.

- [ ] **Step 1: Failing test** — append a test to `use-products.test.tsx` (model on the existing `useProductSearch` test; capture the request `q`):
```ts
it("useProductNameSearch builds a name:(~…) filter", async () => {
  let seen: URLSearchParams | null = null;
  server.use(
    http.get("https://api.emporix.io/product/acme/products", ({ request }) => {
      seen = new URL(request.url).searchParams;
      return HttpResponse.json([{ id: "p1" }]);
    }),
  );
  const { result } = renderHook(() => useProductNameSearch("in time"), { wrapper: wrap() });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect((seen as URLSearchParams | null)?.get("q")).toBe("name:(~in time)");
});
```
(Add `useProductNameSearch` to the import from `../src/hooks/use-products`. If the test file uses a different helper name than `wrap`, match it.)

- [ ] **Step 2: Run, verify fail** — `pnpm -F @viu/emporix-sdk-react test -- --run use-products` → FAIL.

- [ ] **Step 3: Implement** — in `use-products.ts`, after `useProductSearch`:
```ts
/** Free-text product search by name (builds the Emporix name filter). Disabled when empty/whitespace. */
export function useProductNameSearch(
  term: string | undefined,
  params: { pageNumber?: number; pageSize?: number } = {},
  options: QueryOpts = {},
): UseQueryResult<PaginatedItems<Product>> {
  const { client } = useEmporix();
  const { ctx } = useReadAuth(options.auth);
  const { siteCode } = useReadSite();
  return useQuery({
    queryKey: emporixKey("product-name-search", [term, params], { tenant: client.tenant, authKind: ctx.kind, siteCode }),
    enabled: typeof term === "string" && term.trim() !== "",
    queryFn: () => client.products.searchByName(term as string, params, ctx),
    staleTime: PRODUCTS_STALE_TIME,
  });
}
```

- [ ] **Step 4: Export** — add `useProductNameSearch` to the `export { … } from "./use-products"` block in `packages/react/src/hooks/index.ts`.

- [ ] **Step 5: Run, verify pass + typecheck** — `pnpm -F @viu/emporix-sdk-react test -- --run use-products` PASS; `pnpm -F @viu/emporix-sdk-react typecheck`.

- [ ] **Step 6: Commit**
```bash
git add packages/react/src/hooks/use-products.ts packages/react/src/hooks/index.ts packages/react/tests/use-products.test.tsx
git commit -m "feat(react): add useProductNameSearch hook"
```

---

## Task 3: Demo — use the hook; drop the local copies (+ Phase 1 carry-over)

**Files:** Modify `examples/storefront-demo/src/pages/Search.tsx`, `examples/storefront-demo/src/lib/adapters.ts`.

- [ ] **Step 1: Rebuild SDK+react so the example sees the new exports**
```bash
pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react build
```

- [ ] **Step 2: Search page uses the hook** — in `Search.tsx`, replace the `useProductSearch` import with `useProductNameSearch`, drop the `productSearchQuery` import, and replace the query building:
```ts
import { useProductNameSearch } from "@viu/emporix-sdk-react";
// …
const q = params.get("q") ?? "";
const { data, isLoading, isFetching } = useProductNameSearch(q.trim() ? q : "", { pageSize: 24 });
```

- [ ] **Step 3: Remove the now-unused `productSearchQuery`** from `examples/storefront-demo/src/lib/adapters.ts` (the `name:(~…)` builder — it now lives in the SDK).

- [ ] **Step 4: Carry-over — de-dup `productIdFromYrn`** in `adapters.ts`: add `import { productIdFromYrn } from "@viu/emporix-sdk";` and delete the local `productIdFromYrn` definition (the Phase 1 de-dup that didn't reach main).

- [ ] **Step 5: Typecheck the demo** — `pnpm -F @viu/emporix-examples-storefront-demo typecheck`.

- [ ] **Step 6: Commit**
```bash
git add examples/storefront-demo/src/pages/Search.tsx examples/storefront-demo/src/lib/adapters.ts
git commit -m "refactor(examples): use SDK searchByName + productIdFromYrn"
```

---

## Task 4: Changeset, full verify, live check

- [ ] **Step 1: Changeset** — create `.changeset/product-search-by-name.md`:
```md
---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

feat(product): add searchByName free-text helper + useProductNameSearch

`products.searchByName(term)` builds the Emporix `name:(~<term>)` regex filter
(escaping metacharacters) and delegates to `search`, so consumers no longer
hand-build the `q` DSL (a bare term 400s). Adds the `useProductNameSearch`
React hook.
```

- [ ] **Step 2: Full verify**
```bash
pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react build
pnpm -r typecheck && pnpm -r test
```
Expected: all green; SDK +1 test, React +1 test.

- [ ] **Step 3: Live check** — start the demo, search `?q=Zugriff` → results; `?q=in time` → graceful "No matches" (200, not 400). Stop the dev server after.

- [ ] **Step 4: Commit**
```bash
git add .changeset/product-search-by-name.md
git commit -m "chore(release): changeset for searchByName + useProductNameSearch"
```

---

## Completion

REQUIRED SUB-SKILL `superpowers:finishing-a-development-branch`. Branch `feat/product-search-by-name` (off `main`). Push with `git push -u origin feat/product-search-by-name`.
