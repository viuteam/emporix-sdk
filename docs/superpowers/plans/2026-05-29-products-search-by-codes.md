# products.searchByCodes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `client.products.searchByCodes(codes)` (bulk fetch by code, analogous to `searchByIds`) plus a `useProductsByCodes` React hook.

**Architecture:** A new `ProductService.searchByCodes` dedupes codes, drops codes containing query-delimiter characters (with a logged warning), then chunks at 100 and POSTs `q="code:(c1,c2,…)"` to `/products/search` — mirroring `searchByIds`. A React-Query hook wraps it following the existing product-hook convention.

**Tech Stack:** TypeScript, Vitest + MSW, @tanstack/react-query, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-05-29-products-search-by-codes-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/sdk/src/services/product.ts` | new `searchByCodes` method |
| `packages/sdk/tests/services/product.test.ts` | 4 new test cases |
| `packages/react/src/hooks/use-products.ts` | new `useProductsByCodes` hook |
| `packages/react/src/hooks/index.ts` | re-export the hook |
| `packages/react/src/index.ts` | re-export the hook (public API) |
| `packages/react/tests/use-products.test.tsx` | 2 new hook tests |
| `docs/products.md` | document `searchByCodes` |
| `.changeset/products-search-by-codes.md` | minor for both packages |

All commands run from the repo root: `/Users/dominic.fritschi/projects/viu/emporix-sdk`.

**Cross-package note:** `@viu/emporix-sdk-react` typechecks AND runs its tests against the **built `dist/`** of `@viu/emporix-sdk`. So Task 2 must rebuild the SDK before touching React, or `client.products.searchByCodes` won't exist for the React layer.

---

## Task 1: SDK `searchByCodes`

**Files:**
- Modify: `packages/sdk/src/services/product.ts`
- Test: `packages/sdk/tests/services/product.test.ts`

- [ ] **Step 1: Write the failing tests**

Append this block to `packages/sdk/tests/services/product.test.ts` (after the final `describe(...)`, before the end of file). It reuses the file's existing `svc()` and `server`/imports.

```ts
describe("ProductService.searchByCodes", () => {
  function svcWithLogger() {
    const cfg = {
      tenant: "acme", host: "https://api.emporix.io",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
    } as never;
    const tokenProvider = new DefaultTokenProvider(cfg);
    const logger = new MemoryLogger(new LevelResolver({ level: "warn" }), { service: "product" });
    const httpClient = new HttpClient({
      host: "https://api.emporix.io", provider: tokenProvider, logger,
      retry: { maxAttempts: 1 }, timeouts: { connectMs: 1000, readMs: 1000 },
    });
    return { service: new ProductService({ tenant: "acme", http: httpClient, tokenProvider, logger }), logger };
  }

  it("chunks at 100 and returns the union (250 codes -> 3 POSTs)", async () => {
    let calls = 0;
    server.use(
      http.post("https://api.emporix.io/product/acme/products/search", async ({ request }) => {
        calls += 1;
        const body = (await request.json()) as { q: string };
        const inner = body.q.replace(/^code:\(/, "").replace(/\)$/, "");
        return HttpResponse.json(inner.split(",").map((c) => ({ id: c, code: c })));
      }),
    );
    const codes = Array.from({ length: 250 }, (_, i) => `c${i}`);
    const products = await svc().searchByCodes(codes);
    expect(calls).toBe(3);
    expect(products).toHaveLength(250);
    expect(new Set(products.map((p) => p.code))).toEqual(new Set(codes));
  });

  it("returns [] with no HTTP call for empty input", async () => {
    let calls = 0;
    server.use(
      http.post("https://api.emporix.io/product/acme/products/search", () => {
        calls += 1;
        return HttpResponse.json([]);
      }),
    );
    expect(await svc().searchByCodes([])).toEqual([]);
    expect(calls).toBe(0);
  });

  it("de-duplicates codes before building the query", async () => {
    let seenQ = "";
    server.use(
      http.post("https://api.emporix.io/product/acme/products/search", async ({ request }) => {
        seenQ = ((await request.json()) as { q: string }).q;
        return HttpResponse.json([{ id: "A", code: "A" }, { id: "B", code: "B" }]);
      }),
    );
    await svc().searchByCodes(["A", "A", "B"]);
    expect(seenQ).toBe("code:(A,B)");
  });

  it("drops codes with delimiter chars, queries the rest, and warns", async () => {
    let seenQ = "";
    server.use(
      http.post("https://api.emporix.io/product/acme/products/search", async ({ request }) => {
        seenQ = ((await request.json()) as { q: string }).q;
        return HttpResponse.json([{ id: "A", code: "A" }]);
      }),
    );
    const { service, logger } = svcWithLogger();
    const products = await service.searchByCodes(["A", "B C", "D,E"]);
    expect(seenQ).toBe("code:(A)");
    expect(products.map((p) => p.code)).toEqual(["A"]);
    const warn = logger.entries.find((e) => e.level === "warn");
    expect(warn?.msg).toMatch(/dropped codes/i);
    expect(warn?.fields.dropped).toEqual(["B C", "D,E"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/product.test.ts -t searchByCodes`
Expected: FAIL — `searchByCodes` is not a function on `ProductService`.

- [ ] **Step 3: Implement `searchByCodes`**

In `packages/sdk/src/services/product.ts`, insert the method immediately **before** the `listVariantChildrenAll` doc comment. Anchor — find this line:

```ts
  /**
   * Streams the VARIANT children of a PARENT_VARIANT product, page by page,
```

and insert the following block right before it:

```ts
  /**
   * Bulk fetch by code. POSTs `/products/search` with `q="code:(c1,c2,…)"`,
   * chunking when the list is larger than `options.chunkSize` (default 100).
   * Duplicate codes are de-duplicated. Codes containing query-delimiter
   * characters (`(`, `)`, `,`, whitespace, `"`) are dropped with a logged
   * warning, because the Emporix `q` syntax uses them as delimiters and does
   * not support escaping them in a plain IN-list. An empty list — or one with
   * no safe codes — short-circuits with no HTTP call. **Order is not
   * guaranteed** across chunks — re-index by `code` if order matters.
   */
  async searchByCodes(
    codes: string[],
    options: { chunkSize?: number } = {},
    auth: AuthContext = ANON,
  ): Promise<Product[]> {
    const unique = [...new Set(codes)];
    const unsafe = /[(),"\s]/;
    const safe = unique.filter((c) => !unsafe.test(c));
    const dropped = unique.filter((c) => unsafe.test(c));
    if (dropped.length > 0) {
      this.ctx.logger.warn(
        "products.searchByCodes: dropped codes containing query-delimiter characters",
        { dropped },
      );
    }
    if (safe.length === 0) return [];
    const chunkSize = options.chunkSize ?? 100;
    const chunks: string[][] = [];
    for (let i = 0; i < safe.length; i += chunkSize) {
      chunks.push(safe.slice(i, i + chunkSize));
    }
    const pages = await Promise.all(
      chunks.map((chunk) =>
        this.ctx.http.request<Product[]>({
          method: "POST",
          path: `/product/${this.ctx.tenant}/products/search`,
          query: { pageSize: chunk.length },
          auth,
          body: { q: `code:(${chunk.join(",")})` },
        }),
      ),
    );
    return pages.flat();
  }

```

- [ ] **Step 4: Run the tests + typecheck to verify they pass**

Run:
```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/product.test.ts -t searchByCodes
pnpm -F @viu/emporix-sdk typecheck
```
Expected: 4 tests PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/product.ts packages/sdk/tests/services/product.test.ts
git commit -m "feat(product): add searchByCodes bulk fetch"
```

---

## Task 2: React `useProductsByCodes`

**Files:**
- Modify: `packages/react/src/hooks/use-products.ts`, `packages/react/src/hooks/index.ts`, `packages/react/src/index.ts`
- Test: `packages/react/tests/use-products.test.tsx`

- [ ] **Step 1: Rebuild the SDK so `dist/` exposes `searchByCodes`**

React typechecks and runs its tests against the built SDK. Run:
```bash
pnpm -F @viu/emporix-sdk build
```
Expected: build completes; `grep -c "searchByCodes" packages/sdk/dist/index.js` returns ≥ 1.

- [ ] **Step 2: Write the failing tests**

In `packages/react/tests/use-products.test.tsx`, add `useProductsByCodes` to the hook import block (it currently imports `useProduct, useProducts, useProductsInfinite, useProductByCode, useProductSearch` from `../src/hooks/use-products`):

```ts
import {
  useProduct,
  useProducts,
  useProductsInfinite,
  useProductByCode,
  useProductSearch,
  useProductsByCodes,
} from "../src/hooks/use-products";
```

Then append this `describe` block at the end of the file:

```tsx
describe("useProductsByCodes", () => {
  it("is disabled when codes is empty", () => {
    const { result } = renderHook(() => useProductsByCodes([]), { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("fetches products for the given codes", async () => {
    server.use(
      http.post("https://api.emporix.io/product/acme/products/search", async ({ request }) => {
        const body = (await request.json()) as { q: string };
        expect(body.q).toBe("code:(A,B)");
        return HttpResponse.json([
          { id: "1", code: "A" },
          { id: "2", code: "B" },
        ]);
      }),
    );
    const { result } = renderHook(() => useProductsByCodes(["A", "B"]), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((p) => p.code)).toEqual(["A", "B"]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm -F @viu/emporix-sdk-react exec vitest run tests/use-products.test.tsx -t useProductsByCodes`
Expected: FAIL — `useProductsByCodes` is not exported from `../src/hooks/use-products`.

- [ ] **Step 4: Implement the hook**

Append to `packages/react/src/hooks/use-products.ts` (it already imports `useQuery`, `UseQueryResult`, `Product`, `useEmporix`, `useReadAuth`, `QueryOpts`, `useReadSite`, `emporixKey`):

```ts
/**
 * Bulk-fetches products by `code`. Order is not guaranteed — re-index by
 * `code` if needed. Disabled when `codes` is empty.
 */
export function useProductsByCodes(
  codes: string[],
  options: { chunkSize?: number } & QueryOpts = {},
): UseQueryResult<Product[]> {
  const { client } = useEmporix();
  const { ctx } = useReadAuth(options.auth);
  const { siteCode } = useReadSite();
  return useQuery({
    queryKey: emporixKey("products-by-codes", [codes, options.chunkSize], {
      tenant: client.tenant,
      authKind: ctx.kind,
      siteCode,
    }),
    enabled: codes.length > 0,
    queryFn: () =>
      client.products.searchByCodes(
        codes,
        options.chunkSize !== undefined ? { chunkSize: options.chunkSize } : {},
        ctx,
      ),
    staleTime: 30_000,
  });
}
```

- [ ] **Step 5: Re-export the hook**

In `packages/react/src/hooks/index.ts`, add `useProductsByCodes` to the `./use-products` re-export:

```ts
export {
  useProduct,
  useProducts,
  useProductsInfinite,
  useProductByCode,
  useProductSearch,
  useProductsByCodes,
} from "./use-products";
```

In `packages/react/src/index.ts`, add `useProductsByCodes,` to the named export list right after `useProductSearch,`:

```ts
  useProductByCode,
  useProductSearch,
  useProductsByCodes,
  useVariantChildren,
```

- [ ] **Step 6: Run the tests + typecheck to verify they pass**

Run:
```bash
pnpm -F @viu/emporix-sdk-react exec vitest run tests/use-products.test.tsx -t useProductsByCodes
pnpm -F @viu/emporix-sdk-react typecheck
```
Expected: 2 tests PASS; typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/hooks/use-products.ts packages/react/src/hooks/index.ts packages/react/src/index.ts packages/react/tests/use-products.test.tsx
git commit -m "feat(react): add useProductsByCodes hook"
```

---

## Task 3: Documentation

**Files:**
- Modify: `docs/products.md`

- [ ] **Step 1: Add `searchByCodes` to the standard-reads list**

In `docs/products.md`, change the line:
```
`getByCode`, `list` / `listAll`, `search`, `searchByIds`.
```
to:
```
`getByCode`, `list` / `listAll`, `search`, `searchByIds`, `searchByCodes`.
```

- [ ] **Step 2: Add a usage section**

Add this section after the intro paragraph (before `## Variant children`):

```markdown
## Bulk fetch by id or code

`searchByIds` and `searchByCodes` bulk-fetch via `POST /products/search`,
chunking at 100 (override with `{ chunkSize }`). Order is **not** guaranteed —
re-index the result by `id` / `code`.

```ts
const byId = await client.products.searchByIds(["id1", "id2"]);
const byCode = await client.products.searchByCodes(["SKU-1", "SKU-2"]);
```

`searchByCodes` de-duplicates codes and **drops** any code containing `(`, `)`,
`,`, whitespace, or `"` (logging a warning with the dropped codes), because the
Emporix `q` syntax uses those characters as delimiters and does not support
escaping them in a plain IN-list. An empty input — or one with no safe codes —
returns `[]` without an HTTP call.

In React: `useProductsByCodes(codes, { chunkSize? })` (disabled while `codes` is
empty; 30s stale-time).
```

- [ ] **Step 3: Commit**

```bash
git add docs/products.md
git commit -m "docs(product): document searchByCodes"
```

---

## Task 4: Changeset + final verification

**Files:**
- Create: `.changeset/products-search-by-codes.md`

- [ ] **Step 1: Write the changeset**

Create `.changeset/products-search-by-codes.md`:

```markdown
---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add `products.searchByCodes(codes, { chunkSize? })` — bulk-fetch products by
`code` via `POST /products/search` (`q="code:(…)"`), chunked at 100, analogous
to `searchByIds`. Codes with query-delimiter characters are dropped with a
warning. Adds the `useProductsByCodes` React hook (30s stale-time).
```

- [ ] **Step 2: Verify the changeset (CI-style)**

Run: `pnpm changeset status --since=origin/main`
Expected: lists `@viu/emporix-sdk` and `@viu/emporix-sdk-react` at minor; exits 0.

- [ ] **Step 3: Commit**

```bash
git add .changeset/products-search-by-codes.md
git commit -m "chore(release): add searchByCodes changeset"
```

- [ ] **Step 4: Final verification**

```bash
pnpm -F @viu/emporix-sdk test
pnpm -F @viu/emporix-sdk build
pnpm -F @viu/emporix-sdk-react test
pnpm -F @viu/emporix-sdk-react typecheck
pnpm -F @viu/emporix-sdk-react lint
```
All expected to pass.

---

## Self-Review (performed while writing)

- **Spec coverage:** Req 1 (method signature, q=code:(…), default chunkSize 100, empty→[], order not guaranteed) → Task 1. Req 2 (escape vs filter → **filter + warn**, verified against spec) → Task 1 Step 3 + tests. Req 3 (250→3 reqs/union, empty→no call, dedupe, special-char handling) → Task 1 Step 1 (4 cases). Req 4 (`useProductsByCodes`, key convention, 30s stale) → Task 2. Req 5 (docs) → Task 3. Req 6 (changeset minor both packages) → Task 4. No gaps.
- **Placeholder scan:** No TBD/TODO; every code step has full code; all commands have expected output.
- **Type consistency:** `searchByCodes(codes, options, auth)` signature identical across Task 1 (impl), Task 2 (hook call), Task 4 (changeset). `useProductsByCodes(codes, options)` consistent between Task 2 test, impl, and exports. Query value form `code:(A,B)` consistent across SDK test, React test, and impl. Unsafe-char regex `/[(),"\s]/` is the single source of the drop rule.
