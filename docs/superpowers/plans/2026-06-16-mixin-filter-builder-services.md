# Mixin Filter Builder (Service Rollout) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the mixin filter builder into the remaining storefront- and admin-relevant SDK services (Category, Order, CustomerAdmin, Vendor), each routing its `q` through `resolveQuery` with the correct entity gate, plus a `useCategorySearch` hook and `q` support on `useMyOrders`.

**Architecture:** Reuses Plan 1's `resolveQuery` normalizer and `QueryFor<E>` type. Each service typing its `q` argument as `QueryFor<"<ENTITY>">` makes a wrong-entity filter a compile error; all four target entities are non-compound, so each calls `resolveQuery(q, { compoundLogicalQuery: false })` (an `or()` filter throws). No new endpoints — every change extends an existing list/search method or its body.

**Tech Stack:** TypeScript, Vitest + MSW, `@tanstack/react-query`, pnpm workspaces.

**Scope note:** Plan 2 of 2 from `docs/superpowers/specs/2026-06-16-mixin-filter-builder-design.md`. Depends on Plan 1 (`@viu/emporix-mixins` builder + `resolveQuery` + `QueryFor` already merged on this branch). **In scope:** Category, Order, CustomerAdmin, Vendor. **Deliberately excluded** (recorded in the spec, not built here): Cart search and Availability body-`q` (admin-only, low storefront value); Price (the SDK has no price-list listing endpoint — adding one is a separate feature); the non-mixin passthrough services Approval/Segment/Fee/Schema (a mixin filter there is meaningless — a raw `q` string already works).

**Cross-package build note:** `packages/react` resolves `@viu/emporix-sdk` via its built `dist/` (no tsconfig path mapping). After the SDK tasks (1–4) add new methods, **rebuild the SDK** before the React tasks (5–6) or React typecheck/tests won't see `categories.search` / the new `q` option. Task 5 starts with that build.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/sdk/src/services/category.ts` | add `search(q)` (GET, `q`) | Modify |
| `packages/sdk/tests/services/category.test.ts` | test category search | Modify |
| `packages/sdk/src/services/orders.ts` | add `q` to `ListMyOrdersOptions` + `listMine` | Modify |
| `packages/sdk/tests/services/orders.test.ts` | test `listMine` `q` | Modify |
| `packages/sdk/src/services/customer-admin-types.ts` | type `q` on `AdminCustomerSearchQuery` | Modify |
| `packages/sdk/src/services/customer-admin.ts` | resolve `q` in `searchCustomers` | Modify |
| `packages/sdk/tests/services/customer-admin.test.ts` | test customer search `q` | Modify |
| `packages/sdk/src/services/vendor-types.ts` | type `q` on `VendorSearchQuery` | Modify |
| `packages/sdk/src/services/vendor.ts` | resolve `q` in `searchVendors` | Modify |
| `packages/sdk/tests/services/vendor.test.ts` | test vendor search `q` | Modify |
| `packages/react/src/hooks/use-categories.ts` | add `useCategorySearch` | Modify |
| `packages/react/src/hooks/index.ts` | export `useCategorySearch` | Modify |
| `packages/react/tests/use-categories.test.tsx` | test the hook | Modify |
| `packages/react/src/hooks/use-my-orders.ts` | add `q` option | Modify |
| `packages/react/tests/use-my-orders.test.tsx` | test the option | Modify |
| `docs/mixin-search.md` | update capability matrix | Modify |
| `.changeset/mixin-filter-services.md` | release note | Create |

---

## Task 1: `CategoryService.search`

**Files:**
- Modify: `packages/sdk/src/services/category.ts`
- Test: `packages/sdk/tests/services/category.test.ts`

- [ ] **Step 1: Write the failing test**

Add this `describe` block at the end of `packages/sdk/tests/services/category.test.ts`:

```ts
describe("CategoryService.search", () => {
  it("sends q + pagination and wraps the array into PaginatedItems", async () => {
    let seen: URLSearchParams | null = null;
    server.use(
      http.get("https://api.emporix.io/category/acme/categories", ({ request }) => {
        seen = new URL(request.url).searchParams;
        return HttpResponse.json([{ id: "c1" }, { id: "c2" }]);
      }),
    );
    const page = await svc().search("mixins.attrs.featured:true", { pageNumber: 2, pageSize: 2 });
    expect(page.items.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(page.hasNextPage).toBe(true);
    expect((seen as URLSearchParams | null)?.get("q")).toBe("mixins.attrs.featured:true");
    expect((seen as URLSearchParams | null)?.get("pageNumber")).toBe("2");
  });

  it("accepts a built filter (toString) and rejects an or() filter (Category is non-compound)", async () => {
    let seen: URLSearchParams | null = null;
    server.use(
      http.get("https://api.emporix.io/category/acme/categories", ({ request }) => {
        seen = new URL(request.url).searchParams;
        return HttpResponse.json([{ id: "c1" }]);
      }),
    );
    await svc().search({ toString: () => "mixins.attrs.featured:true", usesCompound: false });
    expect((seen as URLSearchParams | null)?.get("q")).toBe("mixins.attrs.featured:true");
    await expect(
      svc().search({ toString: () => "compoundLogicalQuery:((a) OR (b))", usesCompound: true }),
    ).rejects.toThrow(/does not support/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/category.test.ts`
Expected: FAIL — `svc().search` is not a function.

- [ ] **Step 3: Add the `search` method**

In `packages/sdk/src/services/category.ts`, add the import after the auth import:

```ts
import { resolveQuery, type QueryFor } from "../core/query";
```

Add this method to the `CategoryService` class, right after the `list()` method:

```ts
  /**
   * Searches categories by a `q` filter — a raw Emporix DSL string or a built
   * filter (e.g. `@viu/emporix-mixins`' `mixinQuery(...)`). Category does not
   * support `compoundLogicalQuery`, so `or()` filters are rejected.
   */
  async search(
    query: QueryFor<"CATEGORY">,
    params: { pageNumber?: number; pageSize?: number } = {},
    auth: AuthContext = ANON,
  ): Promise<PaginatedItems<Category>> {
    const q = resolveQuery(query, { compoundLogicalQuery: false });
    const pageNumber = params.pageNumber ?? 1;
    const pageSize = params.pageSize ?? 50;
    const items = await this.ctx.http.request<Category[]>({
      method: "GET",
      path: `/category/${this.ctx.tenant}/categories`,
      query: { q, pageNumber, pageSize },
      auth,
    });
    return { items, pageNumber, pageSize, hasNextPage: items.length === pageSize };
  }
```

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/category.test.ts`
Expected: PASS (new block + all existing category tests).

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/category.ts packages/sdk/tests/services/category.test.ts
git commit -m "feat(category): accept a built mixin filter in categories.search"
```

---

## Task 2: `OrdersService.listMine` accepts `q`

**Files:**
- Modify: `packages/sdk/src/services/orders.ts`
- Test: `packages/sdk/tests/services/orders.test.ts`

- [ ] **Step 1: Write the failing test**

Add this `describe` block at the end of `packages/sdk/tests/services/orders.test.ts`:

```ts
describe("OrdersService.listMine — q filter", () => {
  it("resolves a built filter and sends it as q", async () => {
    let seen: URLSearchParams | null = null;
    server.use(
      http.get("https://api.emporix.io/order-v2/acme/orders", ({ request }) => {
        seen = new URL(request.url).searchParams;
        return HttpResponse.json([{ id: "o-1", status: "CREATED", currency: "CHF", totalPrice: 1, entries: [] }], {
          headers: { "X-Total-Count": "1" },
        });
      }),
    );
    await svc().listMine(CUST, {
      q: { toString: () => "mixins.orderAttrs.priority:high", usesCompound: false },
    });
    expect((seen as URLSearchParams | null)?.get("q")).toBe("mixins.orderAttrs.priority:high");
  });

  it("rejects an or() filter (Order is non-compound)", async () => {
    await expect(
      svc().listMine(CUST, {
        q: { toString: () => "compoundLogicalQuery:((a) OR (b))", usesCompound: true },
      }),
    ).rejects.toThrow(/does not support/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/orders.test.ts`
Expected: FAIL — `q` is not a known property of `ListMyOrdersOptions` (type error), and no `q` is sent.

- [ ] **Step 3: Add the `q` option + resolution**

In `packages/sdk/src/services/orders.ts`, add the import after the auth import:

```ts
import { resolveQuery, type QueryFor } from "../core/query";
```

Add the `q` field to the `ListMyOrdersOptions` interface (after `siteCode`):

```ts
  /** A `q` filter — raw DSL string or a built filter (e.g. mixinQuery for entity "ORDER"). */
  q?: QueryFor<"ORDER">;
```

In `listMine`, add a `q` resolution after the existing `setIfDefined` calls (after the `siteCode` line):

```ts
    if (opts.q !== undefined) {
      setIfDefined(query, "q", resolveQuery(opts.q, { compoundLogicalQuery: false }));
    }
```

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/orders.test.ts`
Expected: PASS (new block + existing listMine tests).

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/orders.ts packages/sdk/tests/services/orders.test.ts
git commit -m "feat(sdk): accept a built mixin filter as q in orders.listMine"
```

---

## Task 3: `CustomerAdminService.searchCustomers` resolves `q`

**Files:**
- Modify: `packages/sdk/src/services/customer-admin-types.ts`
- Modify: `packages/sdk/src/services/customer-admin.ts`
- Test: `packages/sdk/tests/services/customer-admin.test.ts`

- [ ] **Step 1: Write the failing test**

Add this `describe` block at the end of `packages/sdk/tests/services/customer-admin.test.ts`:

```ts
describe("CustomerAdminService.searchCustomers — q filter", () => {
  it("resolves a built filter in the body's q field", async () => {
    let seenBody: { q?: unknown } | null = null;
    server.use(
      http.post(`${BASE}/search`, async ({ request }) => {
        seenBody = (await request.json()) as { q?: unknown };
        return HttpResponse.json([{ id: "cust-1" }]);
      }),
    );
    await svc().searchCustomers({
      q: { toString: () => "mixins.loyalty.tier:gold", usesCompound: false },
    });
    expect((seenBody as { q?: unknown } | null)?.q).toBe("mixins.loyalty.tier:gold");
  });

  it("passes a raw string q through unchanged", async () => {
    let seenBody: { q?: unknown } | null = null;
    server.use(
      http.post(`${BASE}/search`, async ({ request }) => {
        seenBody = (await request.json()) as { q?: unknown };
        return HttpResponse.json([]);
      }),
    );
    await svc().searchCustomers({ q: "status:active" });
    expect((seenBody as { q?: unknown } | null)?.q).toBe("status:active");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/customer-admin.test.ts`
Expected: FAIL — the built-filter object is sent as `q` unchanged (an object, not its `toString()`), so the first assertion fails.

- [ ] **Step 3: Type `q` and resolve it**

In `packages/sdk/src/services/customer-admin-types.ts`, add the import at the top (after the generated-types import):

```ts
import type { QueryFor } from "../core/query";
```

Replace the `AdminCustomerSearchQuery` definition:

```ts
/** Search body (`POST /customers/search`). `q` accepts a raw DSL string or a built filter. */
export type AdminCustomerSearchQuery = Record<string, unknown> & {
  q?: QueryFor<"CUSTOMER">;
};
```

In `packages/sdk/src/services/customer-admin.ts`, add the import after the auth import:

```ts
import { resolveQuery } from "../core/query";
```

Replace the `searchCustomers` method:

```ts
  /** Search customers (`POST /customers/search`). A built filter in `q` is resolved to a string. */
  async searchCustomers(query: AdminCustomerSearchQuery, auth: AuthContext = SERVICE): Promise<AdminCustomerList> {
    const body =
      query.q !== undefined
        ? { ...query, q: resolveQuery(query.q, { compoundLogicalQuery: false }) }
        : query;
    return this.ctx.http.request<AdminCustomerList>({ method: "POST", path: `${this.base()}/search`, auth, body });
  }
```

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/customer-admin.test.ts`
Expected: PASS (new block + existing customer-admin tests).

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/customer-admin-types.ts packages/sdk/src/services/customer-admin.ts packages/sdk/tests/services/customer-admin.test.ts
git commit -m "feat(customer): resolve a built mixin filter in customerAdmin.searchCustomers"
```

---

## Task 4: `VendorService.searchVendors` resolves `q`

**Files:**
- Modify: `packages/sdk/src/services/vendor-types.ts`
- Modify: `packages/sdk/src/services/vendor.ts`
- Test: `packages/sdk/tests/services/vendor.test.ts`

- [ ] **Step 1: Write the failing test**

Add this `describe` block at the end of `packages/sdk/tests/services/vendor.test.ts`:

```ts
describe("VendorService.searchVendors — q filter", () => {
  it("resolves a built filter in the body's q field", async () => {
    let seenBody: { q?: unknown } | null = null;
    server.use(
      http.post(`${BASE}/vendors/search`, async ({ request }) => {
        seenBody = (await request.json()) as { q?: unknown };
        return HttpResponse.json([{ id: "v-1" }]);
      }),
    );
    await svc().searchVendors({
      q: { toString: () => "mixins.vendorAttrs.region:EU", usesCompound: false },
    });
    expect((seenBody as { q?: unknown } | null)?.q).toBe("mixins.vendorAttrs.region:EU");
  });

  it("passes a raw string q through unchanged", async () => {
    let seenBody: { q?: unknown } | null = null;
    server.use(
      http.post(`${BASE}/vendors/search`, async ({ request }) => {
        seenBody = (await request.json()) as { q?: unknown };
        return HttpResponse.json([]);
      }),
    );
    await svc().searchVendors({ q: "name:Acme" });
    expect((seenBody as { q?: unknown } | null)?.q).toBe("name:Acme");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/vendor.test.ts`
Expected: FAIL — the built-filter object is sent as `q` unchanged, so the first assertion fails.

- [ ] **Step 3: Type `q` and resolve it**

In `packages/sdk/src/services/vendor-types.ts`, add the import at the top (after the generated-types import):

```ts
import type { QueryFor } from "../core/query";
```

Replace the `VendorSearchQuery` definition:

```ts
/** Search body (`POST /vendors/search`). `q` accepts a raw DSL string or a built filter. */
export type VendorSearchQuery = Record<string, unknown> & {
  q?: QueryFor<"VENDOR">;
};
```

In `packages/sdk/src/services/vendor.ts`, add the import after the auth import:

```ts
import { resolveQuery } from "../core/query";
```

Replace the `searchVendors` method:

```ts
  /** Search vendors (`POST /vendors/search`). A built filter in `q` is resolved to a string. */
  async searchVendors(query: VendorSearchQuery, auth: AuthContext = SERVICE): Promise<VendorList> {
    const body =
      query.q !== undefined
        ? { ...query, q: resolveQuery(query.q, { compoundLogicalQuery: false }) }
        : query;
    return this.ctx.http.request<VendorList>({
      method: "POST",
      path: `${this.base()}/vendors/search`,
      auth,
      body,
    });
  }
```

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/vendor.test.ts`
Expected: PASS (new block + existing vendor tests).

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/vendor-types.ts packages/sdk/src/services/vendor.ts packages/sdk/tests/services/vendor.test.ts
git commit -m "feat(sdk): resolve a built mixin filter in vendor.searchVendors"
```

---

## Task 5: `useCategorySearch` hook

**Files:**
- Modify: `packages/react/src/hooks/use-categories.ts`
- Modify: `packages/react/src/hooks/index.ts`
- Test: `packages/react/tests/use-categories.test.tsx`

- [ ] **Step 1: Rebuild the SDK so React resolves the new API**

Run: `pnpm -F @viu/emporix-sdk build`
Expected: build completes. (React resolves `@viu/emporix-sdk` via its `dist/`; `categories.search` must be present for both typecheck and the runtime test.)

- [ ] **Step 2: Write the failing test**

Add this `describe` block at the end of `packages/react/tests/use-categories.test.tsx` (it imports `useCategorySearch`, `waitFor`, `http`, `HttpResponse` which are already imported in that file except the hook — add `useCategorySearch` to the existing `from "../src/hooks/use-categories"` import):

First, add `useCategorySearch` to the existing hook import block at the top of the file:

```ts
import {
  useCategory,
  useSubcategories,
  useCategories,
  useProductsInCategory,
  useProductsInCategoryInfinite,
  useCategorySearch,
} from "../src/hooks/use-categories";
```

Then add this block at the end of the file:

```ts
describe("useCategorySearch", () => {
  it("is disabled on empty query", () => {
    const { result } = renderHook(() => useCategorySearch(""), { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("sends the built filter string as q", async () => {
    let seen: URLSearchParams | undefined;
    server.use(
      http.get("https://api.emporix.io/category/acme/categories", ({ request }) => {
        seen = new URL(request.url).searchParams;
        return HttpResponse.json([{ id: "c1" }]);
      }),
    );
    const filter = { toString: () => "mixins.attrs.featured:true", usesCompound: false };
    const { result } = renderHook(() => useCategorySearch(filter), { wrapper: wrap() });
    await waitFor(() => expect(result.current.data?.items?.length).toBe(1));
    expect(seen?.get("q")).toBe("mixins.attrs.featured:true");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-react exec vitest run tests/use-categories.test.tsx`
Expected: FAIL — `useCategorySearch` is not exported.

- [ ] **Step 4: Add the hook**

In `packages/react/src/hooks/use-categories.ts`, add `QueryFor` to the `@viu/emporix-sdk` import:

```ts
import {
  type PaginatedItems,
  type Category,
  type Product,
  type QueryFor,
} from "@viu/emporix-sdk";
```

Add this hook at the end of the file (after `useProductsInCategoryInfinite`):

```ts
/** Category search. Accepts a raw `q` string or a built filter. Disabled when empty/whitespace. */
export function useCategorySearch(
  query: QueryFor<"CATEGORY"> | undefined,
  params: { pageNumber?: number; pageSize?: number } = {},
  options: QueryOpts = {},
): UseQueryResult<PaginatedItems<Category>> {
  const { client } = useEmporix();
  const qStr = typeof query === "string" ? query : (query?.toString() ?? "");
  return useEmporixQuery({
    mode: "read-auth", site: "full", resource: "category-search", args: [qStr, params],
    ...(options.auth ? { authOverride: options.auth } : {}),
    enabled: qStr.trim() !== "",
    queryFn: (ctx) => client.categories.search(query as QueryFor<"CATEGORY">, params, ctx),
    staleTime: CATEGORIES_STALE_TIME,
  });
}
```

In `packages/react/src/hooks/index.ts`, add `useCategorySearch` to the categories export block:

```ts
export {
  useCategory,
  useSubcategories,
  useCategories,
  useCategoriesInfinite,
  useCategoryTree,
  useProductsInCategory,
  useProductsInCategoryInfinite,
  useCategorySearch,
} from "./use-categories";
```

- [ ] **Step 5: Run test + typecheck to verify they pass**

Run: `pnpm -F @viu/emporix-sdk-react exec vitest run tests/use-categories.test.tsx`
Expected: PASS

Run: `pnpm -F @viu/emporix-sdk-react typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/hooks/use-categories.ts packages/react/src/hooks/index.ts packages/react/tests/use-categories.test.tsx
git commit -m "feat(react): add useCategorySearch hook accepting a built mixin filter"
```

---

## Task 6: `useMyOrders` accepts `q`

**Files:**
- Modify: `packages/react/src/hooks/use-my-orders.ts`
- Test: `packages/react/tests/use-my-orders.test.tsx`

- [ ] **Step 1: Write the failing test**

Add this `it` block inside the existing `describe("useMyOrders", ...)` in `packages/react/tests/use-my-orders.test.tsx` (after the existing tests, before the describe's closing brace):

```ts
  it("sends a built filter as q", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    let seen: URLSearchParams | undefined;
    server.use(
      http.get("https://api.emporix.io/order-v2/acme/orders", ({ request }) => {
        seen = new URL(request.url).searchParams;
        return HttpResponse.json([{ id: "o-1", status: "CREATED", currency: "CHF", totalPrice: 1, entries: [] }], {
          headers: { "X-Total-Count": "1" },
        });
      }),
    );
    const filter = { toString: () => "mixins.orderAttrs.priority:high", usesCompound: false };
    const { result } = renderHook(() => useMyOrders({ q: filter, legalEntityId: null }), {
      wrapper: wrap(storage),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seen?.get("q")).toBe("mixins.orderAttrs.priority:high");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-react exec vitest run tests/use-my-orders.test.tsx`
Expected: FAIL — `q` is not a known property of `UseMyOrdersOptions` (type error), and no `q` is sent.

- [ ] **Step 3: Add the `q` option**

In `packages/react/src/hooks/use-my-orders.ts`, add `QueryFor` to the `@viu/emporix-sdk` import:

```ts
import { type Order, type OrderStatus, type PaginatedItems, type QueryFor } from "@viu/emporix-sdk";
```

Add the `q` field to `UseMyOrdersOptions` (after `saasToken`):

```ts
  /** A `q` filter — raw DSL string or a built filter (e.g. mixinQuery for entity "ORDER"). */
  q?: QueryFor<"ORDER">;
```

Replace the body of `useMyOrders` (from `const effectiveLE` through the `return`):

```ts
  const effectiveLE: string | undefined =
    options.legalEntityId === null
      ? undefined
      : (options.legalEntityId ?? activeCompany?.id);
  const qStr =
    options.q === undefined ? null : typeof options.q === "string" ? options.q : options.q.toString();
  return useEmporixQuery({
    mode: "customer", site: "full", resource: "orders",
    args: ["mine", effectiveLE ?? null, options.status ?? null, options.pageNumber ?? 1, options.pageSize ?? null, qStr],
    queryFn: (ctx) =>
      client.orders.listMine(ctx, {
        ...(options.pageNumber !== undefined ? { pageNumber: options.pageNumber } : {}),
        ...(options.pageSize !== undefined ? { pageSize: options.pageSize } : {}),
        ...(options.status !== undefined ? { status: options.status } : {}),
        ...(effectiveLE !== undefined ? { legalEntityId: effectiveLE } : {}),
        ...(siteCode ? { siteCode } : {}),
        ...(options.saasToken !== undefined ? { saasToken: options.saasToken } : {}),
        ...(options.q !== undefined ? { q: options.q } : {}),
      }),
  });
```

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run: `pnpm -F @viu/emporix-sdk-react exec vitest run tests/use-my-orders.test.tsx`
Expected: PASS (new test + existing useMyOrders tests).

Run: `pnpm -F @viu/emporix-sdk-react typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/hooks/use-my-orders.ts packages/react/tests/use-my-orders.test.tsx
git commit -m "feat(react): accept a built mixin filter as q in useMyOrders"
```

---

## Task 7: Docs + changeset

**Files:**
- Modify: `docs/mixin-search.md`
- Create: `.changeset/mixin-filter-services.md`

- [ ] **Step 1: Update the capability matrix**

In `docs/mixin-search.md`, replace the capability-matrix table with:

```markdown
| Service | mixin `q` filter | `or()` (`compoundLogicalQuery`) | In the SDK |
|---|---|---|---|
| Product | yes | **yes** | `products.search` / `useProductSearch` |
| Category | yes | no (use `and()`) | `categories.search` / `useCategorySearch` |
| Order | yes | no (use `and()`) | `orders.listMine({ q })` / `useMyOrders({ q })` |
| Customer (admin) | yes | no (use `and()`) | `customerAdmin.searchCustomers({ q })` |
| Vendor (admin) | yes | no (use `and()`) | `vendor.searchVendors({ q })` |
| Cart, Price, Availability | yes | varies | not wired yet (admin/niche) |
| Approval, Segment, Fee, Schema instances | no mixins | — | raw `q` string only |
```

- [ ] **Step 2: Write the changeset**

Create `.changeset/mixin-filter-services.md`:

```markdown
---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Wire the mixin filter builder into more services. `categories.search`,
`orders.listMine({ q })`, `customerAdmin.searchCustomers({ q })` and
`vendor.searchVendors({ q })` now accept a built mixin filter (or a raw `q`
string), each entity-gated via `QueryFor<E>` and routed through `resolveQuery`
(all are non-compound, so `or()` filters are rejected). New React hooks:
`useCategorySearch` and a `q` option on `useMyOrders`.
```

- [ ] **Step 3: Verify the changeset is recognized**

Run: `pnpm changeset status`
Expected: lists `@viu/emporix-sdk` and `@viu/emporix-sdk-react` to be bumped (minor).

- [ ] **Step 4: Commit**

```bash
git add docs/mixin-search.md .changeset/mixin-filter-services.md
git commit -m "docs(docs): document the mixin filter service rollout and add changeset"
```

---

## Final verification

- [ ] **Run the full per-package suites + repo typecheck/lint**

```bash
pnpm -F @viu/emporix-sdk build   # ensure dist reflects all new SDK methods
pnpm -F @viu/emporix-sdk test
pnpm -F @viu/emporix-sdk-react test
pnpm typecheck
pnpm lint
```
Expected: all PASS.

---

## Self-Review (completed by plan author)

**Spec coverage (the in-scope slice):**
- Category `q` (+ hook) → Tasks 1, 5 ✓
- Order `q` (+ hook option) → Tasks 2, 6 ✓
- Customer (admin) `q` → Task 3 ✓
- Vendor (admin) `q` → Task 4 ✓
- All four entity-gated via `QueryFor<"ENTITY">`, all non-compound → `{ compoundLogicalQuery: false }`, `or()` rejected ✓
- Docs + changeset → Task 7 ✓
- **Excluded (recorded):** Cart, Availability, Price (new endpoint), and non-mixin passthrough services — per the scope decision.

**Placeholder scan:** none — every code step has complete code.

**Type consistency:** every service types `q` as `QueryFor<"<ENTITY>">` (PRODUCT done in Plan 1; CATEGORY/ORDER/CUSTOMER/VENDOR here); `resolveQuery(q, { compoundLogicalQuery: false })` matches the Plan 1 `QueryCapability` signature; the React hooks coerce via `query?.toString()` and key on the resolved string, exactly like `useProductSearch`. `AdminCustomerSearchQuery`/`VendorSearchQuery` keep their `Record<string, unknown>` base so existing callers still compile.

**Cross-package build:** Task 5 rebuilds the SDK before React tasks so `dist/` exposes the new methods (React has no tsconfig path mapping to SDK `src`).

**Commit scopes:** commitlint `scope-enum` has no `orders`/`vendor`/`customer-admin` — Order/Vendor commits use `sdk`, Customer uses `customer`, Category uses `category`, React uses `react`, docs uses `docs`. (`mixins` is also absent — not needed here since Plan 2 touches no mixins-package source.)
