# Split `hooks/queries.ts` by Service Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `packages/react/src/hooks/queries.ts` with domain-aligned files (`use-products.ts`, `use-categories.ts`, `use-cart.ts`) matching the existing hook-file convention; extract the shared `useReadAuth` helper; fix the missing `useCategoriesInfinite` re-export.

**Architecture:** Pure file-structure refactor. No hook behavior, no public-API names, and no React-Query keys change. The package root (`@viu/emporix-sdk-react`) keeps re-exporting every existing hook plus the now-fixed `useCategoriesInfinite`. The cart-read hook (`useCart`) moves into the cart file (renamed `use-cart-mutations.ts` → `use-cart.ts`) so all cart hooks live together. `useReadAuth` and `QueryOpts` move to `hooks/internal/use-read-auth.ts` as a private shared helper.

**Tech Stack:** TypeScript, Vitest, MSW, TanStack React Query v5, pnpm workspaces.

**Context for the engineer:**

- Read the spec first: `docs/superpowers/specs/2026-05-20-split-queries-by-domain-design.md`.
- Branch: `feat/split-queries-by-domain` (already created off `main`).
- Commitlint enforces `scope-enum` + lowercase subject first word. Use `refactor(react): split queries.ts …`.
- Pre-commit hook runs typecheck + lint. Each commit should leave the repo green.
- Mechanical refactor — favor moving code, not rewriting it. The simplest diff that works is the right diff.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/react/src/hooks/internal/use-read-auth.ts` | Shared private helper | **CREATE** — exports `useReadAuth` + `QueryOpts` |
| `packages/react/src/hooks/use-products.ts` | Product read hooks | **CREATE** — useProduct, useProducts, useProductsInfinite |
| `packages/react/src/hooks/use-categories.ts` | Category read hooks | **CREATE** — useCategory, useCategories, useCategoriesInfinite, useCategoryTree |
| `packages/react/src/hooks/use-cart.ts` | All cart hooks | **CREATE** (replaces `use-cart-mutations.ts`) — useCart, useCartMutations, useCreateCart |
| `packages/react/src/hooks/queries.ts` | — | **DELETE** |
| `packages/react/src/hooks/use-cart-mutations.ts` | — | **DELETE** |
| `packages/react/src/hooks/use-product-media.ts` | (existing) | Update `./queries` import to `./use-products` |
| `packages/react/src/hooks/index.ts` | Barrel | Update import paths; **add** `useCategoriesInfinite` export |
| `packages/react/src/index.ts` | Package root | **add** `useCategoriesInfinite` |
| `packages/react/tests/queries.test.tsx` | — | **DELETE** (split test) |
| `packages/react/tests/use-products.test.tsx` | Product hook tests | **CREATE** — content from queries.test.tsx (Product tests) |
| `packages/react/tests/use-categories.test.tsx` | Category hook tests | **CREATE** — content from queries.test.tsx (Category tests) |
| `packages/react/tests/use-cart.test.tsx` | Cart hook tests | **RENAME** from `use-cart-mutations.test.tsx`; absorb the `useCart` tests from queries.test.tsx |
| `packages/react/tests/use-cart-mutations.test.tsx` | — | **DELETE** (renamed) |
| `packages/react/tests/use-categories-infinite.test.tsx` | (existing) | Update imports |
| `.changeset/split-queries-by-domain.md` | Release notes | **CREATE** — patch changeset |

---

## Task 1: Extract `useReadAuth` helper

**Files:**
- Create: `packages/react/src/hooks/internal/use-read-auth.ts`

- [ ] **Step 1: Create the file**

```bash
mkdir -p packages/react/src/hooks/internal
```

Then create `packages/react/src/hooks/internal/use-read-auth.ts`:

```typescript
import { auth, type AuthContext } from "@viu/emporix-sdk";
import { useEmporix } from "../../provider";

/** Options accepted by every read hook to override the per-call auth context. */
export interface QueryOpts {
  auth?: AuthContext;
}

/**
 * Picks the auth context for a read hook. If `override` is given, returns it.
 * Otherwise: customer if a token is in storage, anonymous as fallback.
 * The `kind` string is included in query-keys so cache entries are
 * separated per auth boundary.
 */
export function useReadAuth(
  override?: AuthContext,
): { ctx: AuthContext; kind: string } {
  const { storage } = useEmporix();
  if (override) return { ctx: override, kind: override.kind };
  const token = storage.getCustomerToken();
  return token
    ? { ctx: auth.customer(token), kind: "customer" }
    : { ctx: auth.anonymous(), kind: "anonymous" };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm -F @viu/emporix-sdk-react typecheck`
Expected: PASS — file is new and self-contained.

- [ ] **Step 3: Commit**

```bash
git add packages/react/src/hooks/internal/use-read-auth.ts
git commit -m "refactor(react): extract useReadAuth + QueryOpts to internal helper"
```

---

## Task 2: Create `use-products.ts`

**Files:**
- Create: `packages/react/src/hooks/use-products.ts`

- [ ] **Step 1: Create the file**

Copy the three Product hooks from `queries.ts` (functions `useProduct`, `useProducts`, `useProductsInfinite`) into `packages/react/src/hooks/use-products.ts`:

```typescript
import {
  useQuery,
  useInfiniteQuery,
  type UseQueryResult,
  type UseInfiniteQueryResult,
} from "@tanstack/react-query";
import { type PaginatedItems, type Product } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useReadAuth, type QueryOpts } from "./internal/use-read-auth";

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
```

- [ ] **Step 2: Typecheck**

Run: `pnpm -F @viu/emporix-sdk-react typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/react/src/hooks/use-products.ts
git commit -m "refactor(react): add use-products.ts with product read hooks"
```

---

## Task 3: Create `use-categories.ts`

**Files:**
- Create: `packages/react/src/hooks/use-categories.ts`

- [ ] **Step 1: Create the file**

Copy the four Category hooks (`useCategory`, `useCategories`, `useCategoriesInfinite`, `useCategoryTree`) from `queries.ts` into `packages/react/src/hooks/use-categories.ts`:

```typescript
import {
  useQuery,
  useInfiniteQuery,
  type UseQueryResult,
  type UseInfiniteQueryResult,
} from "@tanstack/react-query";
import { type PaginatedItems, type Category, type CategoryNode } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useReadAuth, type QueryOpts } from "./internal/use-read-auth";

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
```

- [ ] **Step 2: Typecheck**

Run: `pnpm -F @viu/emporix-sdk-react typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/react/src/hooks/use-categories.ts
git commit -m "refactor(react): add use-categories.ts with category read hooks"
```

---

## Task 4: Merge `useCart` into a new `use-cart.ts` (rename of `use-cart-mutations.ts`)

**Files:**
- Modify (will become rename source): `packages/react/src/hooks/use-cart-mutations.ts`
- Create: `packages/react/src/hooks/use-cart.ts`
- Delete (after merge): `packages/react/src/hooks/use-cart-mutations.ts`

- [ ] **Step 1: Create `use-cart.ts` with full content**

Create `packages/react/src/hooks/use-cart.ts` containing the current content of `use-cart-mutations.ts` PLUS the `useCart` read hook from `queries.ts`. Concretely the file should have at the top:

```typescript
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  auth,
  type AuthContext,
  type Cart,
  type CartAddress,
  type CartCreated,
  type CartItemInput,
  type CartItemUpdate,
  type CreateCartInput,
} from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useReadAuth, type QueryOpts } from "./internal/use-read-auth";

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

Followed by the **exact** content of `use-cart-mutations.ts` from `type Mut<TVars> = …` to the end of file (everything currently in `use-cart-mutations.ts`).

> Tip: instead of duplicating large code in this plan, the safest mechanical operation is `git mv packages/react/src/hooks/use-cart-mutations.ts packages/react/src/hooks/use-cart.ts`, then prepend the `useCart` function + adjust the imports at the top of the renamed file. The note about `useReadAuth + QueryOpts` import above stays.

- [ ] **Step 2: Delete `use-cart-mutations.ts`**

If you used `git mv`, this is already done. Otherwise:

```bash
git rm packages/react/src/hooks/use-cart-mutations.ts
```

- [ ] **Step 3: Typecheck**

Run: `pnpm -F @viu/emporix-sdk-react typecheck`
Expected: At this point the barrel `index.ts` still imports from `./use-cart-mutations` → expect errors. We fix the barrel in Task 6. **DO NOT commit yet**; commit happens after Task 6.

- [ ] **Step 4 (deferred to Task 6): Commit**

Hold the staged changes; we commit together with the barrel update.

---

## Task 5: Update `use-product-media.ts` import

**Files:**
- Modify: `packages/react/src/hooks/use-product-media.ts:2`

- [ ] **Step 1: Update the import**

In `packages/react/src/hooks/use-product-media.ts`, line 2 is currently:

```typescript
import { useProduct } from "./queries";
```

Change to:

```typescript
import { useProduct } from "./use-products";
```

- [ ] **Step 2 (deferred to Task 6): commit**

Hold the staged change. Combined commit with Task 6.

---

## Task 6: Update barrel + delete `queries.ts`

**Files:**
- Modify: `packages/react/src/hooks/index.ts`
- Modify: `packages/react/src/index.ts`
- Delete: `packages/react/src/hooks/queries.ts`

- [ ] **Step 1: Update `packages/react/src/hooks/index.ts`**

Replace the existing block (lines 3-13) so the file becomes:

```typescript
export { useCustomerSession } from "./use-customer-session";
export type { CustomerSessionApi } from "./use-customer-session";
export { useProduct, useProducts, useProductsInfinite } from "./use-products";
export {
  useCategory,
  useCategories,
  useCategoriesInfinite,
  useCategoryTree,
} from "./use-categories";
export { useCart, useCartMutations, useCreateCart } from "./use-cart";
export type { CartMutationsApi } from "./use-cart";
export { useCheckout, usePaymentModes } from "./use-checkout";
export type { CheckoutApi } from "./use-checkout";
export { useMatchPrices } from "./use-match-prices";
export { useProductMedia } from "./use-product-media";
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

- [ ] **Step 2: Update `packages/react/src/index.ts`**

Add `useCategoriesInfinite` to the hooks re-export list. Locate the block (around lines 9-30 of `src/index.ts`) and ensure `useCategoriesInfinite` is in the export list:

```typescript
export {
  useCustomerSession,
  useProduct,
  useProducts,
  useProductsInfinite,
  useCategory,
  useCategories,
  useCategoriesInfinite,
  useCategoryTree,
  useCart,
  useCartMutations,
  useCreateCart,
  useCheckout,
  usePaymentModes,
  useMatchPrices,
  useProductMedia,
  useMySegments,
  useMySegmentItems,
  useMySegmentCategoryTree,
  useMySegmentProducts,
  useMySegmentProductsInfinite,
  useMySegmentCategories,
  useMySegmentCategoriesInfinite,
} from "./hooks/index";
```

If the existing list is missing `useCategoriesInfinite`, add it; everything else stays as-is.

- [ ] **Step 3: Delete `queries.ts`**

```bash
git rm packages/react/src/hooks/queries.ts
```

- [ ] **Step 4: Typecheck + build**

```bash
pnpm -F @viu/emporix-sdk-react typecheck
pnpm -F @viu/emporix-sdk-react build
```

Expected: BOTH pass. If any file still references `./queries`, fix it.

- [ ] **Step 5: Combined commit (Tasks 4+5+6)**

```bash
git add packages/react/src/hooks/ packages/react/src/index.ts
git commit -m "refactor(react): split queries.ts into use-products, use-categories, use-cart"
```

(The single commit captures the rename + delete + barrel update + use-product-media import update + addition of useCategoriesInfinite re-export.)

---

## Task 7: Update test files

**Files:**
- Modify (or split): `packages/react/tests/queries.test.tsx`
- Modify: `packages/react/tests/use-categories-infinite.test.tsx`
- Modify: `packages/react/tests/use-cart-mutations.test.tsx` (may rename)
- Modify: any other test files that import from `../src/hooks/queries`

- [ ] **Step 1: Find affected test files**

Run: `grep -rnl "from \"../src/hooks/queries\"\\|from \"../src/hooks/use-cart-mutations\"" packages/react/tests/`
Note the list of files to update.

- [ ] **Step 2: Decide: rename queries.test.tsx or split**

Recommendation: **rename** the existing file to match the imports it makes. Inspect `packages/react/tests/queries.test.tsx`; if it tests hooks from multiple domains (Products + Categories + Cart), split it into:

- `packages/react/tests/use-products.test.tsx` — Product hook tests
- `packages/react/tests/use-categories.test.tsx` — Category hook tests (excluding the dedicated `use-categories-infinite.test.tsx`)
- `packages/react/tests/use-cart.test.tsx` — useCart (read) tests, and absorbed mutations from the renamed `use-cart-mutations.test.tsx`

If the file is small enough that splitting feels wrong, keep one file but rename to `read-hooks.test.tsx` is **not** acceptable — domain naming please. The simplest move: split into the three per-domain files.

- [ ] **Step 3: Perform the test split**

For each test in `queries.test.tsx`, copy it into the corresponding domain test file (creating the file if it doesn't exist). Update the import statement at the top of the destination file from `"../src/hooks/queries"` to the matching domain file.

Then delete `packages/react/tests/queries.test.tsx`:

```bash
git rm packages/react/tests/queries.test.tsx
```

- [ ] **Step 4: Rename `use-cart-mutations.test.tsx` → `use-cart.test.tsx` if applicable**

If the cart-mutations test file exists separately:

```bash
git mv packages/react/tests/use-cart-mutations.test.tsx packages/react/tests/use-cart.test.tsx
```

Update the import inside from `"../src/hooks/use-cart-mutations"` to `"../src/hooks/use-cart"`. If you absorbed any `useCart` tests from queries.test.tsx, they go here too.

- [ ] **Step 5: Update remaining test imports**

In `packages/react/tests/use-categories-infinite.test.tsx`, change the import from `"../src/hooks/queries"` to `"../src/hooks/use-categories"`.

Any other test file that imports from `./queries` or `./use-cart-mutations` needs the same treatment.

- [ ] **Step 6: Run all React tests**

```bash
pnpm -F @viu/emporix-sdk-react test
```

Expected: ALL tests PASS — no behavioral change, only import paths moved.

- [ ] **Step 7: Commit**

```bash
git add packages/react/tests/
git commit -m "refactor(react): align hook test files with split-by-domain layout"
```

---

## Task 8: Changeset

**Files:**
- Create: `.changeset/split-queries-by-domain.md`

- [ ] **Step 1: Write the changeset**

```markdown
---
"@viu/emporix-sdk-react": patch
---

Refactor `hooks/queries.ts` into domain-aligned files (`use-products.ts`, `use-categories.ts`, `use-cart.ts`) matching the rest of the package. The shared `useReadAuth` helper now lives in `hooks/internal/use-read-auth.ts`. `use-cart-mutations.ts` is consolidated into `use-cart.ts`, which now holds every cart hook (read + mutations + create).

**Fix:** `useCategoriesInfinite` is now re-exported from the package root. It was defined but not exported in the prior release.

No public hook name, behavior, or query-key changed. Consumer imports from `@viu/emporix-sdk-react` continue to work.
```

- [ ] **Step 2: Commit**

```bash
git add .changeset/split-queries-by-domain.md
git commit -m "docs(docs): changeset for split-queries-by-domain"
```

---

## Final Verification

- [ ] **Full monorepo build + tests**

```bash
pnpm -r build
pnpm -r test
```

Expected: ALL PASS.

- [ ] **No remaining references to old paths**

```bash
git grep -nE "\\./queries|\\./use-cart-mutations" packages/ 2>/dev/null
```

Expected: empty.

- [ ] **`useCategoriesInfinite` is reachable from the package root**

```bash
grep -n "useCategoriesInfinite" packages/react/src/index.ts packages/react/dist/index.d.ts
```

Expected: both files mention the symbol.

- [ ] **Examples still typecheck**

```bash
pnpm -F @viu/emporix-examples-vite-spa typecheck
pnpm -F @viu/emporix-examples-next-app-router typecheck
```

Expected: PASS — examples import from `@viu/emporix-sdk-react` (package root), unchanged.

- [ ] **Changeset present**

```bash
ls .changeset/split-queries-by-domain.md
```

Expected: file exists.

---

## Follow-up (out of scope)

- `use-my-segments.ts` could be split into `use-my-segment-products.ts` etc., but it already follows the domain convention and its 7-hook size mirrors the segment hydration mental model. Leave as-is.
- A `hooks/internal/` directory could host more shared helpers as the codebase grows; for now `use-read-auth.ts` is the only inhabitant.
