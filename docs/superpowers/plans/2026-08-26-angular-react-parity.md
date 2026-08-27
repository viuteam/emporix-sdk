# Angular / React Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining 67 gaps between `@viu/emporix-sdk-angular` and `@viu/emporix-sdk-react` so the Angular package can ship at storefront parity in its first release.

**Architecture:** Every new read is a thin wrapper over the existing `injectEmporixQuery` / `injectEmporixInfinite` factories, so auth resolution, the `["emporix", …]` cache key and the `enabled` gate stay in one place. Every new write goes through one shared `writeBundle` helper that owns the `isPending` / `error` signals and the post-success invalidation, extracted from the pattern `injectCartMutations` already established. The one genuinely new design is the B2B company context: a signal-based equivalent of React's `CompanyContextProvider`, built as a mirror of the existing `site.ts` / `site-switch.ts` split.

**Tech Stack:** Angular 22 (peers `>=20.0.0 <23.0.0`), `@tanstack/angular-query-experimental ^5.102.0`, TypeScript 6 in the examples / 5.9 in the packages, Vitest + `@angular/platform-browser/testing`, tsup.

**Spec:** [`docs/superpowers/specs/2026-08-25-angular-package-design.md`](../specs/2026-08-25-angular-package-design.md) — this plan deliberately **overrides that spec's scope table**, which capped the package at 33 injectables and listed the rest as out of scope. The scope decision is recorded in «Scope change» below; everything else in that spec (the decorator-free rule, the signal-read rule, the auth modes, the key builder) still governs.

## Global Constraints

- `packages/angular` stays **decorator-free**: no `@Injectable()`, components, directives, pipes or NgModules. Enforced by the ESLint `no-restricted-syntax` rule on `Decorator` nodes, by `scripts/check-dist.mjs`, and by two AOT example builds in CI.
- **Signal reads belong inside `injectQuery`'s options callback.** Read outside and the cache key and `enabled` gate freeze at construction time. `injectEmporixQuery` handles token and site reads; this rule applies to every signal you pass through `args`.
- Package is **ESM only**. Entries: `.`, `./storage`, `./ssr`.
- Peers: `@angular/core` and `@angular/common` `>=20.0.0 <23.0.0`; `@tanstack/angular-query-experimental ^5.102.0`.
- `exactOptionalPropertyTypes: true` repo-wide. Derive parameter types with `Parameters<…>` / `Awaited<ReturnType<…>>` rather than restating SDK shapes.
- **Everything written into the repo is English** — comments, JSDoc, tests, changesets, commit messages, docs.
- Commitlint: scope must be `angular` (or `docs` / `examples` / `repo` where it fits), and the first word after the scope is a **lowercase verb**.
- Coverage gate is **80 %**; the package currently sits at 98.82 % over 169 tests. Every task adds its rows to `tests/injectables-smoke.test.ts` — do not lower the threshold to pass.
- Angular CLI refuses Node v24.11.1. Use `PATH=/opt/homebrew/opt/node/bin:$PATH` (v26.7.0) for any `ng` command.
- New reads use `mode: "customer"` for customer-scoped resources — **never** a throw-on-missing-token helper. See «Deliberate deviations from React».

## Scope change

The design doc scoped the package to 33 injectables and named the other 74 React hooks out of scope, on the argument that a foundation should not carry the whole surface. That argument was right for a foundation and is wrong for a release: a consumer picking the package for a B2B storefront hits the missing 17 company hooks on day one, and «wait for v2» is not an answer when the React package has had them for months.

Measured surface today (from the built `.d.ts`, not from prose):

| | React | Angular |
|---|---|---|
| Public hooks / injectables | 107 (`./hooks` entry) | 40 |
| Same-named pairs | — | 33 |
| React hooks with no same-named injectable | 74 | — |
| …of those, covered under another name or shape | 7 | — |
| **Genuinely missing** | **67** | — |

The 7 already covered, which this plan does **not** re-implement:

| React | Angular equivalent |
|---|---|
| `useChangePassword`, `useChangeEmail`, `useConfirmEmailChange`, `useResendActivation` | `injectCustomerCredentials` (4 methods) |
| `useConfirmSignup` | `injectCustomerSession.confirmSignup` |
| `useProductNameSearch` | `injectProductSearch` — **renamed in Task 1** |
| `useSiteContext` | `injectEmporixSite` |

The 67 become **35 query injectables + 31 mutation methods across 11 bundles + 1 company context**, because the Angular idiom groups writes into one injectable per area rather than one per operation. Final public surface: 40 → **≈87** injectables.

## Deliberate deviations from React

Three places where a 1:1 port would copy a defect. Each is a decision, not an oversight, and each is stated in the task that lands it.

1. **Customer-scoped reads gate, they do not throw.** React's `useShoppingLists`, `useMySegments`, `useApprovals`, `useMyReturns` and the reward-point reads call `useCustomerOnlyCtx()` unconditionally in the hook body, which **throws during render** when no token is stored. The Angular versions use `mode: "customer"`, which resolves to `enabled: false` and issues no request. A logged-out storefront renders empty instead of crashing.
2. **Segment keys route through the shared builder.** React's segment hooks hand-roll `["emporix", "segment", "list", {…}]` instead of calling `emporixKey`. The Angular versions go through `injectEmporixQuery`, so their keys are `emporixKey("segments", …)`. This means the two bindings' segment keys are **not** byte-identical — the only place in the package where that is true. `tests/key-parity.test.ts` asserts the builder is used, which still holds.
3. **`useCloudFunction`'s `staleTime` passthrough is dropped.** React lets the caller set `staleTime` per call; the Angular version takes the `["emporix"]` default (30 s) and an `enabled` option only. A per-call cache lifetime on an arbitrary cloud function is a knob nobody in the examples turns, and it is additive to add later.

Items 1 and 2 are also **candidate follow-up fixes for the React package** — out of scope here, and worth their own PR rather than being smuggled into an Angular release.

## File structure

**New files in `packages/angular/src/injectables/`** — one per area, because files that change together live together and the `site` / `mode` / `staleTime` choices within an area are only reviewable side by side:

| File | Responsibility |
|---|---|
| `internal/write-bundle.ts` | The shared `writeBundle` helper: `isPending` / `error` signals, invalidation, error normalization. Consumed by every mutation bundle. |
| `shopping-lists.ts` | `injectShoppingLists` + `injectShoppingListMutations` |
| `loyalty.ts` | reward points (3 reads + 1 bundle) and coupons (1 bundle) |
| `returns.ts` | `injectMyReturns`, `injectReturn`, `injectReturnMutations` |
| `segments.ts` | the 7 segment reads |
| `approvals.ts` | `injectApprovals`, `injectApproval`, `injectApprovalMutations` |
| `cloud-functions.ts` | `injectCloudFunction`, `injectCloudFunctions` |
| `session-attributes.ts` | `injectSessionAttributeMutations` |
| `companies.ts` | the 5 company reads + `injectCompanyMutations` |

**New files in `packages/angular/src/`** (the company context is peer to the site context, not an injectable):

| File | Responsibility |
|---|---|
| `company.ts` | `createCompanyState`, `injectActiveCompany`, the `EmporixCompanyState` contract |
| `company-switch.ts` | `injectCompanySwitch` — the rescope-token-drop-cart-invalidate sequence |

**Modified:**

| File | Change |
|---|---|
| `src/injectables/catalog.ts` | rename two functions (Task 1); add 8 reads |
| `src/injectables/cart.ts` | add `injectCartValidation`; refactor `injectCartMutations` onto `writeBundle` |
| `src/injectables/checkout.ts` | add `injectPaymentMode` |
| `src/injectables/price.ts` | add `injectAvailabilities` |
| `src/injectables/site.ts` | add `injectDefaultSite` |
| `src/injectables/customer.ts` | add `injectCustomerAddress`; extend `injectAddressMutations` with tag methods |
| `src/injectables/orders.ts` | add `injectSalesOrder` + `injectOrderMutations` |
| `src/tokens.ts` | add `EMPORIX_COMPANY`, `EMPORIX_COMPANY_INTERNAL` |
| `src/provide.ts` | wire the company state; add `initialLegalEntityId` to `EmporixConfig` |
| `src/index.ts` | export everything new |
| `tests/injectables-smoke.test.ts` | one row per new injectable |
| `docs/angular.md` | scope table → parity |

## How to read the per-injectable tables

Each read task shows the **full code for one injectable** and then a table for the rest of that task. The wrappers are genuinely uniform — same 12-line shape, differing only in the seven fields the table gives — so the table is the complete specification, not a placeholder. Write each one by substituting the table row into the shown shape. If a row needs anything the shape cannot express, it gets its own code block instead.

Column meanings: **resource** is the second element of the cache key; **mode** is `read-auth` (customer-or-anonymous) or `customer` (token-gated); **site** is `full` / `language` / `none`; **stale** is the `staleTime` constant.

---

## Phase 0 — Corrections that are free before the release

### Task 1: Fix the crossed product-search names

Today `injectProductSearch` calls `products.searchByName` while React's `useProductSearch` calls `products.search`. Same name, different endpoint. Someone porting a React storefront switches silently from filter search to name search — no type error, both return `PaginatedItems<Product>`. The package is unpublished, so this rename costs nothing now and is a breaking change after the release.

**Files:**
- Modify: `packages/angular/src/injectables/catalog.ts:155` (`injectProductSearch` → `injectProductNameSearch`), `:175` (`injectProductQuery` → `injectProductSearch`)
- Modify: `packages/angular/tests/injectables-smoke.test.ts:143-144`
- Modify: `examples/angular-storefront-demo/src/app/pages/search.ts`
- Modify: `docs/angular.md`

**Interfaces:**
- Produces: `injectProductNameSearch(term: Signal<string | undefined>, params?: Signal<{pageNumber?: number; pageSize?: number}>, opts?: CatalogOpts): CreateQueryResult<PaginatedItems<Product>>` — resource `product-name-search`
- Produces: `injectProductSearch(query: Signal<QueryFor<"PRODUCT"> | undefined>, params: Signal<{pageNumber?: number; pageSize?: number; totalCount?: boolean}>, opts?: CatalogOpts): CreateQueryResult<PaginatedItems<Product>>` — resource `product-search`

- [ ] **Step 1: Write the failing test**

Add to `packages/angular/tests/injectables.test.ts`:

```ts
describe("product search naming matches react", () => {
  it("injectProductSearch calls products.search, not searchByName", async () => {
    boot(false);
    TestBed.runInInjectionContext(() =>
      I.injectProductSearch(signal("name:(~shoe)" as never), signal({})),
    );
    await settleUntil(() => expect(client.products.search).toHaveBeenCalled());
    expect(client.products.searchByName).not.toHaveBeenCalled();
  });

  it("injectProductNameSearch calls products.searchByName", async () => {
    boot(false);
    TestBed.runInInjectionContext(() => I.injectProductNameSearch(signal("shoe")));
    await settleUntil(() => expect(client.products.searchByName).toHaveBeenCalled());
    expect(client.products.search).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-angular test -- injectables`
Expected: FAIL — `injectProductNameSearch is not a function`, and the first test fails because today's `injectProductSearch` calls `searchByName`.

- [ ] **Step 3: Rename both functions**

In `catalog.ts`, rename the `products.searchByName` wrapper to `injectProductNameSearch` and the `products.search` wrapper to `injectProductSearch`. Keep both `resource` strings exactly as they are (`product-name-search` and `product-search`) — the keys are already correct, only the function names were crossed.

- [ ] **Step 4: Update the callers**

`tests/injectables-smoke.test.ts`: the row named `injectProductSearch` with resource `product-name-search` becomes `injectProductNameSearch`; the row named `injectProductQuery` with resource `product-search` becomes `injectProductSearch`.

`examples/angular-storefront-demo/src/app/pages/search.ts`: the demo does free-text search, so it must now call `injectProductNameSearch`.

- [ ] **Step 5: Run the full package suite and the demo build**

Run: `pnpm -F @viu/emporix-sdk-angular test`
Expected: PASS, 171 tests.

Run: `PATH=/opt/homebrew/opt/node/bin:$PATH pnpm -F @viu/emporix-examples-angular-storefront build:prod`
Expected: bundle generation complete, no template or type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/angular docs/angular.md examples/angular-storefront-demo
git commit -m "fix(angular): align the product-search injectable names with react"
```

### Task 2: Extract the shared mutation-bundle helper

Eleven mutation bundles are coming. Each needs the same four things: an `isPending` signal, an `error` signal, a normalized `Error`, and invalidation of its area's keys on success. `injectCartMutations` already implements exactly that inline. Extract it once now rather than eleven times later.

**Files:**
- Create: `packages/angular/src/injectables/internal/write-bundle.ts`
- Create: `packages/angular/tests/write-bundle.test.ts`
- Modify: `packages/angular/src/injectables/cart.ts:242-257` (route `injectCartMutations` through it)

**Interfaces:**
- Produces:
```ts
export interface WriteBundle {
  isPending: Signal<boolean>;
  error: Signal<Error | null>;
  /** Runs `work`, then invalidates `keys`. Sets pending/error around it and rethrows. */
  write: <T>(work: (ctx: AuthContext) => Promise<T>) => Promise<T>;
}
export function writeBundle(keys: readonly (readonly string[])[]): WriteBundle
```
- Consumed by: Tasks 6, 7, 8, 9, 10, 12, 13, 17.

- [ ] **Step 1: Write the failing test**

Create `packages/angular/tests/write-bundle.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TestBed } from "@angular/core/testing";
import { QueryClient } from "@tanstack/angular-query-experimental";
import { createMemoryStorage } from "@viu/emporix-sdk";
import { provideEmporix } from "../src/provide";
import { writeBundle } from "../src/injectables/internal/write-bundle";

let qc: QueryClient;

beforeEach(() => {
  qc = new QueryClient();
  TestBed.configureTestingModule({
    providers: [
      provideEmporix({
        client: { tenant: "acme", config: {} } as never,
        storage: createMemoryStorage(),
        queryClient: qc,
      }),
    ],
  });
});

describe("writeBundle", () => {
  it("invalidates every listed key on success", async () => {
    const spy = vi.spyOn(qc, "invalidateQueries");
    const b = TestBed.runInInjectionContext(() =>
      writeBundle([["emporix", "shopping-lists"], ["emporix", "cart"]]),
    );
    await b.write(async () => "ok");
    expect(spy).toHaveBeenCalledWith({ queryKey: ["emporix", "shopping-lists"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["emporix", "cart"] });
  });

  it("exposes a normalized Error and rethrows it", async () => {
    const b = TestBed.runInInjectionContext(() => writeBundle([["emporix", "x"]]));
    await expect(
      b.write(async () => {
        throw "a string, not an Error";
      }),
    ).rejects.toThrow("a string, not an Error");
    expect(b.error()).toBeInstanceOf(Error);
    expect(b.isPending()).toBe(false);
  });

  it("does not invalidate when the work throws", async () => {
    const spy = vi.spyOn(qc, "invalidateQueries");
    const b = TestBed.runInInjectionContext(() => writeBundle([["emporix", "x"]]));
    await b.write(async () => {
      throw new Error("nope");
    }).catch(() => undefined);
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-angular test -- write-bundle`
Expected: FAIL — cannot resolve `../src/injectables/internal/write-bundle`.

- [ ] **Step 3: Write the implementation**

Create `packages/angular/src/injectables/internal/write-bundle.ts`:

```ts
import { inject, signal, type Signal } from "@angular/core";
import { injectQueryClient } from "@tanstack/angular-query-experimental";
import { type AuthContext, type EmporixStorage } from "@viu/emporix-sdk";
import { EMPORIX_STORAGE } from "../../tokens";
import { ctxFor } from "./auth";

export interface WriteBundle {
  isPending: Signal<boolean>;
  error: Signal<Error | null>;
  write: <T>(work: (ctx: AuthContext) => Promise<T>) => Promise<T>;
}

/**
 * The shared write path for every mutation bundle.
 *
 * One place owns the three things a component needs from a write — is it in
 * flight, did it fail, and is the cache now stale — so eleven bundles cannot
 * drift on any of them. Invalidation runs only on success: a failed write left
 * the server state alone, and re-fetching to learn that costs a billed call.
 */
export function writeBundle(keys: readonly (readonly string[])[]): WriteBundle {
  const storage: EmporixStorage = inject(EMPORIX_STORAGE);
  const qc = injectQueryClient();
  const isPending = signal(false);
  const error = signal<Error | null>(null);

  return {
    isPending: isPending.asReadonly(),
    error: error.asReadonly(),
    write: async <T>(work: (ctx: AuthContext) => Promise<T>): Promise<T> => {
      error.set(null);
      isPending.set(true);
      try {
        const result = await work(ctxFor(storage));
        for (const key of keys) await qc.invalidateQueries({ queryKey: [...key] });
        return result;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        error.set(err);
        throw err;
      } finally {
        isPending.set(false);
      }
    },
  };
}
```

If `ctxFor` is not already in a shared internal module, move it there from `cart.ts` in this step and re-import it at its old call sites.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk-angular test -- write-bundle`
Expected: PASS, 3 tests.

- [ ] **Step 5: Route `injectCartMutations` through it**

Replace the inline `isPending` / `error` / `write` block in `cart.ts` with `writeBundle([["emporix", "cart"], ["emporix", "cart-items"]])`. Keep `resolveId()` in `cart.ts` — the cart-id resolution is cart-specific and does not belong in the shared helper.

- [ ] **Step 6: Run the full suite**

Run: `pnpm -F @viu/emporix-sdk-angular test`
Expected: PASS. The existing cart-mutation tests must pass unchanged — that is the point of the refactor.

- [ ] **Step 7: Commit**

```bash
git add packages/angular
git commit -m "refactor(angular): extract the shared mutation write bundle"
```

---

## Phase 1 — Catalog reads

### Task 3: The six category reads

**Files:**
- Modify: `packages/angular/src/injectables/catalog.ts`
- Modify: `packages/angular/tests/injectables-smoke.test.ts`
- Modify: `packages/angular/src/index.ts` (exports flow through `export * from "./injectables/index"`, so nothing to add)

**Interfaces:**
- Consumes: `injectEmporixQuery`, `injectEmporixInfinite`, `CatalogOpts`, `pass` — all already in `catalog.ts`
- Produces: the six functions in the table below.

- [ ] **Step 1: Write the failing smoke rows**

Add to the `guestReads` table in `tests/injectables-smoke.test.ts`:

```ts
{ name: "injectCategoryParents", resource: "category-parents", run: () => I.injectCategoryParents(signal("c1")), called: () => client.categories.parents },
{ name: "injectChildCategories", resource: "child-categories", run: () => I.injectChildCategories(signal("c1")), called: () => client.categories.childCategories },
{ name: "injectSubcategories", resource: "subcategories", run: () => I.injectSubcategories(signal("c1"), signal({})), called: () => client.categories.subcategories },
{ name: "injectCategorySearch", resource: "category-search", run: () => I.injectCategorySearch(signal("name:x" as never), signal({})), called: () => client.categories.search },
{ name: "injectCategoryTreeById", resource: "category-tree-by-id", run: () => I.injectCategoryTreeById(signal("c1")), called: () => client.categories.getTree },
{ name: "injectCategoriesInfinite", resource: "categories-infinite", run: () => I.injectCategoriesInfinite(signal(5)), called: () => client.categories.list },
```

And extend the mock client's `categories` block in `makeClient()`:

```ts
categories: {
  get: fn(),
  list: listFn(),
  tree: vi.fn(async () => []),
  productsIn: listFn(),
  parents: vi.fn(async () => []),
  childCategories: vi.fn(async () => []),
  subcategories: vi.fn(async () => []),
  search: listFn(),
  getTree: vi.fn(async () => ({ id: "c1", children: [] })),
},
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-angular test -- injectables-smoke`
Expected: FAIL — `I.injectCategoryParents is not a function` on six rows.

- [ ] **Step 3: Write the implementation — the shape, shown once**

This is the shape every row in the table follows:

```ts
/** Ancestors of a category, root first. Disabled until an id is known. */
export function injectCategoryParents(
  categoryId: Signal<string | undefined>,
  opts: CatalogOpts = {},
): CreateQueryResult<Category[]> {
  const { client } = injectEmporix();
  return injectEmporixQuery<Category[], readonly [string]>(
    () => ({
      resource: "category-parents",
      args: [categoryId() ?? ""] as const,
      site: "full",
      mode: "read-auth",
      enabled: (opts.enabled ?? true) && (categoryId() ?? "") !== "",
      queryFn: (ctx) => client.categories.parents(categoryId() as string, ctx),
      staleTime: CATEGORIES_STALE,
    }),
    pass(opts),
  );
}
```

- [ ] **Step 4: Write the remaining five from this table**

| Function | Params | resource | mode | site | stale | queryFn | Returns |
|---|---|---|---|---|---|---|---|
| `injectChildCategories` | `categoryId: Signal<string \| undefined>` | `child-categories` | `read-auth` | `full` | `CATEGORIES_STALE` | `client.categories.childCategories(id, ctx)` | `Category[]` |
| `injectSubcategories` | `categoryId: Signal<string \| undefined>`, `params: Signal<{pageNumber?: number; pageSize?: number}>` | `subcategories` | `read-auth` | `full` | `CATEGORIES_STALE` | `client.categories.subcategories(id, params(), ctx)` | `Category[]` |
| `injectCategorySearch` | `query: Signal<QueryFor<"CATEGORY"> \| undefined>`, `params: Signal<{pageNumber?: number; pageSize?: number; totalCount?: boolean}>` | `category-search` | `read-auth` | `full` | `CATEGORIES_STALE` | `client.categories.search(q, params(), ctx)` | `PaginatedItems<Category>` |
| `injectCategoryTreeById` | `categoryId: Signal<string \| undefined>` | `category-tree-by-id` | `read-auth` | `full` | `CATEGORIES_STALE` | `client.categories.getTree(id, ctx)` | `Awaited<ReturnType<typeof client.categories.getTree>>` |
| `injectCategoriesInfinite` | `pageSize: Signal<number>` | `categories-infinite` | `read-auth` | `full` | `CATEGORIES_STALE` | see below | infinite |

Two rows need more than the shape:

`injectCategorySearch` keys on the **stringified** filter, not the builder object, exactly as `injectProductSearch` does — two builders that produce the same filter must share one cache entry:

```ts
const q = query();
const asString = q === undefined ? "" : String(q);
// args: [asString, params()], enabled: … && asString.trim() !== ""
```

`injectCategoriesInfinite` uses the infinite factory, whose `fetchPage` owns the cursor:

```ts
export function injectCategoriesInfinite(
  pageSize: Signal<number>,
  opts: CatalogOpts = {},
): CreateInfiniteQueryResult<PaginatedItems<Category>> {
  const { client } = injectEmporix();
  return injectEmporixInfinite<Category>(
    () => ({
      resource: "categories-infinite",
      args: [pageSize()] as const,
      site: "full",
      mode: "read-auth",
      enabled: opts.enabled ?? true,
      fetchPage: (pageNumber, ctx) =>
        client.categories.list({ pageNumber, pageSize: pageSize() }, ctx),
      staleTime: CATEGORIES_STALE,
    }),
    pass(opts),
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm -F @viu/emporix-sdk-angular test`
Expected: PASS, 177 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/angular
git commit -m "feat(angular): add the six category read injectables"
```

### Task 4: The two product reads

**Files:**
- Modify: `packages/angular/src/injectables/catalog.ts`
- Modify: `packages/angular/tests/injectables-smoke.test.ts`

**Interfaces:**
- Produces: `injectProductsByCodes`, `injectVariantChildren`

- [ ] **Step 1: Write the failing smoke rows**

```ts
{ name: "injectProductsByCodes", resource: "products-by-codes", run: () => I.injectProductsByCodes(signal(["a", "b"])), called: () => client.products.searchByCodes },
{ name: "injectVariantChildren", resource: "variant-children", run: () => I.injectVariantChildren(signal("v1")), called: () => client.products.listVariantChildren },
```

Add to the mock's `products` block: `searchByCodes: vi.fn(async () => []), listVariantChildren: vi.fn(async () => [])`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-angular test -- injectables-smoke`
Expected: FAIL — two `is not a function` errors.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Bulk-fetches products by `code`. Order is not guaranteed — re-index by `code`
 * if the caller needs it. Disabled while `codes` is empty.
 */
export function injectProductsByCodes(
  codes: Signal<readonly string[]>,
  opts: CatalogOpts & { chunkSize?: number } = {},
): CreateQueryResult<Product[]> {
  const { client } = injectEmporix();
  return injectEmporixQuery<Product[], readonly [string]>(
    () => {
      const list = [...codes()].sort();
      return {
        // Sorted and joined: the same set in a different order is the same query.
        resource: "products-by-codes",
        args: [list.join(",")] as const,
        site: "full",
        mode: "read-auth",
        enabled: (opts.enabled ?? true) && list.length > 0,
        queryFn: (ctx) =>
          client.products.searchByCodes(
            list,
            ctx,
            opts.chunkSize !== undefined ? { chunkSize: opts.chunkSize } : {},
          ),
        staleTime: PRODUCTS_STALE,
      };
    },
    pass(opts),
  );
}

/** Variant children of a parent variant product. Disabled until an id is known. */
export function injectVariantChildren(
  parentVariantId: Signal<string | undefined>,
  opts: CatalogOpts = {},
): CreateQueryResult<Product[]> {
  const { client } = injectEmporix();
  return injectEmporixQuery<Product[], readonly [string]>(
    () => ({
      resource: "variant-children",
      args: [parentVariantId() ?? ""] as const,
      site: "full",
      mode: "read-auth",
      enabled: (opts.enabled ?? true) && (parentVariantId() ?? "") !== "",
      queryFn: (ctx) => client.products.listVariantChildren(parentVariantId() as string, ctx),
      staleTime: PRODUCTS_STALE,
    }),
    pass(opts),
  );
}
```

Confirm `searchByCodes`'s third parameter against `packages/sdk/src/services/product.ts:262` before writing the `chunkSize` passthrough; drop it if the signature differs.

- [ ] **Step 4: Run the tests**

Run: `pnpm -F @viu/emporix-sdk-angular test`
Expected: PASS, 179 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/angular
git commit -m "feat(angular): add the products-by-codes and variant-children reads"
```

---

## Phase 2 — The small storefront gaps

### Task 5: Cart validation, payment mode, availabilities, default site, customer address

Five unrelated one-off reads, batched into one task because each is a four-line wrapper and no reviewer would meaningfully accept one and reject another.

**Files:**
- Modify: `packages/angular/src/injectables/cart.ts`, `checkout.ts`, `price.ts`, `site.ts`, `customer.ts`
- Modify: `packages/angular/tests/injectables-smoke.test.ts`

**Interfaces:**
- Produces: `injectCartValidation`, `injectPaymentMode`, `injectAvailabilities`, `injectDefaultSite`, `injectCustomerAddress`

- [ ] **Step 1: Write the failing smoke rows**

Four go in `guestReads`, one in `customerReads`:

```ts
// guestReads
{ name: "injectCartValidation", resource: "cart-validation", run: () => I.injectCartValidation(signal("cart-1")), called: () => client.carts.validate },
{ name: "injectPaymentMode", resource: "payment-mode", run: () => I.injectPaymentMode(signal("pm1")), called: () => client.payments.getMode },
{ name: "injectAvailabilities", resource: "availabilities", run: () => I.injectAvailabilities(signal(["p1"]), signal("main")), called: () => client.availability.getMany },
{ name: "injectDefaultSite", resource: "site-default", run: () => I.injectDefaultSite(), called: () => client.sites.current },
// customerReads
{ name: "injectCustomerAddress", resource: "customer-address", run: () => I.injectCustomerAddress(signal("a1")), called: () => client.customers.addresses.get },
```

Mock additions: `carts.validate`, `payments.getMode`, `availability.getMany`, `sites.current`, `customers.addresses.get`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-angular test -- injectables-smoke`
Expected: FAIL — five `is not a function` errors.

- [ ] **Step 3: Write the five implementations**

| Function | File | Params | resource | mode | site | stale | queryFn | Returns |
|---|---|---|---|---|---|---|---|---|
| `injectCartValidation` | `cart.ts` | `cartId: Signal<string \| null>` | `cart-validation` | `read-auth` | `full` | `0` | `client.carts.validate(id, ctx)` | `CartValidationResult` |
| `injectPaymentMode` | `checkout.ts` | `id: Signal<string \| undefined>` | `payment-mode` | `read-auth` | `full` | `PAYMENT_MODES_STALE` | `client.payments.getMode(id, ctx)` | `PaymentMode` |
| `injectAvailabilities` | `price.ts` | `productIds: Signal<readonly string[]>`, `siteCode: Signal<string>` | `availabilities` | `read-auth` | `none` | `AVAILABILITY_STALE` | `client.availability.getMany(ids, siteCode(), ctx)` | `Availability[]` |
| `injectDefaultSite` | `site.ts` | none | `site-default` | `read-auth` | `none` | `SITES_STALE` | `client.sites.current(ctx)` | `Site` |
| `injectCustomerAddress` | `customer.ts` | `id: Signal<string \| undefined>` | `customer-address` | **`customer`** | `none` | `CUSTOMER_STALE` | `client.customers.addresses.get(id, ctx)` | `Address` |

`staleTime: 0` on `injectCartValidation` is deliberate and copied from React: a validation result is about right-now stock and pricing, and a cached «valid» is the one answer that must never be served from memory.

`injectAvailabilities` sorts and joins `productIds` into the key the same way Task 4 does — same reasoning, same code.

Each read gated on an id uses `enabled: (opts.enabled ?? true) && (id() ?? "") !== ""`. `injectCustomerAddress` additionally gets its token gate from `mode: "customer"` — do not add a manual token check.

- [ ] **Step 4: Run the tests**

Run: `pnpm -F @viu/emporix-sdk-angular test`
Expected: PASS, 185 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/angular
git commit -m "feat(angular): add cart validation, payment mode, availabilities, default site and single address reads"
```

---

## Phase 3 — Orders

### Task 6: Sales-order read and the order mutation bundle

**Files:**
- Modify: `packages/angular/src/injectables/orders.ts`
- Create: `packages/angular/tests/order-mutations.test.ts`
- Modify: `packages/angular/tests/injectables-smoke.test.ts`

**Interfaces:**
- Consumes: `writeBundle` from Task 2
- Produces:
```ts
export function injectSalesOrder(orderId: Signal<string | undefined>): CreateQueryResult<Order>
export interface EmporixOrderMutations {
  isPending: Signal<boolean>;
  error: Signal<Error | null>;
  cancel: (vars: { orderId: string; reason?: string }) => Promise<void>;
  transition: (vars: { orderId: string; transition: string }) => Promise<void>;
  reorder: (vars: { orderId: string; cartId?: string }) => Promise<{ added: number; failed: number }>;
  updateSalesOrder: (vars: { orderId: string; patch: Record<string, unknown> }) => Promise<Order>;
}
export function injectOrderMutations(): EmporixOrderMutations
```

- [ ] **Step 1: Write the failing test**

`reorder` is the only method with real logic — it reads an order and batches its items into a cart — so it gets a behavioural test rather than a smoke row. Create `packages/angular/tests/order-mutations.test.ts`:

```ts
describe("injectOrderMutations", () => {
  it("reorder reads the order and batches its items into the active cart", async () => {
    boot(true);
    storage.setCartId("cart-1");
    client.orders.get = vi.fn(async () => ({
      id: "EON1",
      items: [{ itemYrn: "y1", quantity: 2 }],
    })) as never;
    const m = TestBed.runInInjectionContext(() => I.injectOrderMutations());
    const result = await m.reorder({ orderId: "EON1" });
    expect(client.orders.get).toHaveBeenCalled();
    expect(client.carts.addItemsBatch).toHaveBeenCalled();
    expect(result.added).toBe(1);
  });

  it("cancel surfaces a failure on error() and rethrows", async () => {
    boot(true);
    client.orders.cancel = vi.fn(async () => {
      throw new Error("409");
    }) as never;
    const m = TestBed.runInInjectionContext(() => I.injectOrderMutations());
    await expect(m.cancel({ orderId: "EON1" })).rejects.toThrow("409");
    expect(m.error()?.message).toBe("409");
    expect(m.isPending()).toBe(false);
  });

  it("is token-gated: no request without a customer token", async () => {
    boot(false);
    const m = TestBed.runInInjectionContext(() => I.injectOrderMutations());
    await expect(m.cancel({ orderId: "EON1" })).rejects.toThrow();
    expect(client.orders.cancel).not.toHaveBeenCalled();
  });
});
```

Reuse the `boot` / `settleUntil` helpers from `injectables-smoke.test.ts` — extract them into `tests/support.ts` in this step if they are still private to that file, and re-import them there.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-angular test -- order-mutations`
Expected: FAIL — `I.injectOrderMutations is not a function`.

- [ ] **Step 3: Write the implementation**

```ts
/** Orders read: a single sales order by id. Customer-scoped. */
export function injectSalesOrder(
  orderId: Signal<string | undefined>,
  opts: OrdersOpts = {},
): CreateQueryResult<Order> {
  const { client } = injectEmporix();
  return injectEmporixQuery<Order, readonly [string]>(
    () => ({
      resource: "sales-order",
      args: [orderId() ?? ""] as const,
      site: "none",
      mode: "customer",
      enabled: (opts.enabled ?? true) && (orderId() ?? "") !== "",
      queryFn: (ctx) => client.salesOrders.get(orderId() as string, ctx),
      staleTime: ORDERS_STALE,
    }),
    pass(opts),
  );
}

/**
 * Order writes: cancel, transition, reorder and the sales-order patch.
 *
 * `reorder` is the only one that is more than a call: it reads the order, maps
 * its lines to a batch body and posts them to the cart in one request rather
 * than one per line. A partially-failed batch is reported, not thrown — Emporix
 * answers per entry, and a shopper who got nine of ten lines wants to see which
 * one is missing, not an error page.
 */
export function injectOrderMutations(): EmporixOrderMutations {
  const { client } = injectEmporix();
  const storage: EmporixStorage = inject(EMPORIX_STORAGE);
  const b = writeBundle([
    ["emporix", "my-orders"],
    ["emporix", "order"],
    ["emporix", "sales-order"],
    ["emporix", "cart"],
    ["emporix", "cart-items"],
  ]);

  return {
    isPending: b.isPending,
    error: b.error,
    cancel: (v) =>
      b.write((ctx) =>
        client.orders.cancel(v.orderId, ctx, v.reason !== undefined ? { reason: v.reason } : {}),
      ),
    transition: (v) => b.write((ctx) => client.orders.transition(v.orderId, v.transition, ctx)),
    updateSalesOrder: (v) => b.write((ctx) => client.salesOrders.update(v.orderId, v.patch, ctx)),
    reorder: (v) =>
      b.write(async (ctx) => {
        const order = await client.orders.get(v.orderId, ctx);
        const items = (order as { items?: { itemYrn?: string; quantity?: number }[] }).items ?? [];
        const cartId = v.cartId ?? storage.getCartId();
        if (cartId === null || cartId === undefined) {
          throw new EmporixError(
            "injectOrderMutations.reorder: no cartId — bootstrap a cart first (injectActiveCart({ create: true }))",
          );
        }
        const body = items.map((i, index) => ({ index, itemYrn: i.itemYrn, quantity: i.quantity }));
        const res = await client.carts.addItemsBatch(cartId, body as never, ctx);
        const entries = (res as { entries?: { status?: number }[] }).entries ?? [];
        const added = entries.filter((e) => (e.status ?? 500) < 300).length;
        return { added, failed: entries.length - added };
      }),
  };
}
```

Check `orders.cancel` and `orders.transition` signatures against `packages/sdk/src/services/order.ts` before writing — React passes a `saasToken` option to `orders.get` in its reorder hook (`use-reorder.ts:39`), and if the SDK requires it here too, read it from `storage` the way `injectCustomerSession` does.

- [ ] **Step 4: Add the smoke row for the read**

```ts
// customerReads
{ name: "injectSalesOrder", resource: "sales-order", run: () => I.injectSalesOrder(signal("EON1")), called: () => client.salesOrders.get },
```

- [ ] **Step 5: Run the tests**

Run: `pnpm -F @viu/emporix-sdk-angular test`
Expected: PASS, 189 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/angular
git commit -m "feat(angular): add the sales-order read and the order mutation bundle"
```

---

## Phase 4 — Address tags

### Task 7: Extend the address mutation bundle with tag operations

**Files:**
- Modify: `packages/angular/src/injectables/customer.ts`
- Modify: `packages/angular/tests/injectables.test.ts`

**Interfaces:**
- Produces, added to the existing `EmporixAddressMutations`:
```ts
addTags: (vars: { addressId: string; tags: readonly string[] }) => Promise<void>;
removeTags: (vars: { addressId: string; tags: readonly string[] }) => Promise<void>;
```

- [ ] **Step 1: Write the failing test**

```ts
it("addressMutations.addTags posts the tags and invalidates the address list", async () => {
  boot(true);
  const qcSpy = vi.spyOn(qc, "invalidateQueries");
  const m = TestBed.runInInjectionContext(() => I.injectAddressMutations());
  await m.addTags({ addressId: "a1", tags: ["default_billing"] });
  expect(client.customers.addresses.addTags).toHaveBeenCalledWith(
    "a1",
    ["default_billing"],
    expect.anything(),
  );
  expect(qcSpy).toHaveBeenCalledWith({ queryKey: ["emporix", "customer-addresses"] });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-angular test -- injectables`
Expected: FAIL — `m.addTags is not a function`.

- [ ] **Step 3: Write the implementation**

Add two methods to the object `injectAddressMutations` returns, using the bundle's `write`:

```ts
addTags: (v) => write((ctx) => client.customers.addresses.addTags(v.addressId, [...v.tags], ctx)),
removeTags: (v) =>
  write((ctx) => client.customers.addresses.removeTags(v.addressId, [...v.tags], ctx)),
```

The mock in `injectables-smoke.test.ts` already stubs `addTags` and `removeTags` (`tests/injectables-smoke.test.ts:79-80`), so no mock change is needed.

- [ ] **Step 4: Run the tests**

Run: `pnpm -F @viu/emporix-sdk-angular test`
Expected: PASS, 190 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/angular
git commit -m "feat(angular): add address tag operations to the address mutations"
```

---

## Phase 5 — Shopping lists

### Task 8: Shopping lists read and mutation bundle

**Files:**
- Create: `packages/angular/src/injectables/shopping-lists.ts`
- Create: `packages/angular/tests/shopping-lists.test.ts`
- Modify: `packages/angular/src/injectables/index.ts` (add `export * from "./shopping-lists";`)
- Modify: `packages/angular/tests/injectables-smoke.test.ts`

**Interfaces:**
- Consumes: `writeBundle`, `injectEmporixQuery`, `injectEmporix`
- Produces:
```ts
export function injectShoppingLists(
  name?: Signal<string | undefined>,
  opts?: { enabled?: boolean },
): CreateQueryResult<ShoppingList[]>

export interface EmporixShoppingListMutations {
  isPending: Signal<boolean>;
  error: Signal<Error | null>;
  create: (draft: ShoppingListDraft) => Promise<{ id: string }>;
  remove: (vars: { customerId: string; name?: string }) => Promise<void>;
  addItem: (vars: { customerId: string; listName: string; item: ShoppingListItem }) => Promise<void>;
  removeItem: (vars: { customerId: string; listName: string; productId: string }) => Promise<void>;
  setItemQuantity: (vars: {
    customerId: string;
    listName: string;
    productId: string;
    quantity: number;
  }) => Promise<void>;
}
export function injectShoppingListMutations(): EmporixShoppingListMutations
```

`remove`, not `delete` — `delete` is a reserved word and an object method named `delete` reads badly at the call site.

- [ ] **Step 1: Write the failing test**

Create `packages/angular/tests/shopping-lists.test.ts`:

```ts
describe("injectShoppingLists", () => {
  it("issues no request for a guest and does not throw", async () => {
    boot(false);
    const q = TestBed.runInInjectionContext(() => I.injectShoppingLists());
    TestBed.inject(ApplicationRef).tick();
    expect(client.shoppingLists.list).not.toHaveBeenCalled();
    expect(q.isError()).toBe(false);
  });

  it("fetches once a customer token is stored", async () => {
    boot(true);
    TestBed.runInInjectionContext(() => I.injectShoppingLists());
    await settleUntil(() => expect(client.shoppingLists.list).toHaveBeenCalled());
  });

  it("re-keys when the name filter signal changes", async () => {
    boot(true);
    const name = signal<string | undefined>("wishlist");
    TestBed.runInInjectionContext(() => I.injectShoppingLists(name));
    await settleUntil(() => expect(client.shoppingLists.list).toHaveBeenCalledTimes(1));
    name.set("later");
    await settleUntil(() => expect(client.shoppingLists.list).toHaveBeenCalledTimes(2));
  });
});

describe("injectShoppingListMutations", () => {
  it("invalidates the list after a successful create", async () => {
    boot(true);
    const spy = vi.spyOn(qc, "invalidateQueries");
    const m = TestBed.runInInjectionContext(() => I.injectShoppingListMutations());
    await m.create({ name: "wishlist" } as never);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["emporix", "shopping-lists"] });
  });
});
```

The guest test is the one that matters: it is the deviation from React, where the same call throws.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-angular test -- shopping-lists`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * The caller's shopping lists, optionally filtered by name.
 *
 * `mode: "customer"` rather than a token assertion: a logged-out storefront
 * renders an empty list and issues no request. React's hook throws here, which
 * is a crash on a page a guest is allowed to visit.
 */
export function injectShoppingLists(
  name?: Signal<string | undefined>,
  opts: { enabled?: boolean } = {},
): CreateQueryResult<ShoppingList[]> {
  const { client } = injectEmporix();
  return injectEmporixQuery<ShoppingList[], readonly [string | null]>(
    () => {
      const filter = name?.() ?? null;
      return {
        resource: "shopping-lists",
        args: [filter] as const,
        site: "full",
        mode: "customer",
        enabled: opts.enabled ?? true,
        queryFn: (ctx) =>
          client.shoppingLists.list(ctx, filter !== null ? { name: filter } : {}),
        staleTime: SHOPPING_LIST_STALE,
      };
    },
    {},
  );
}

export function injectShoppingListMutations(): EmporixShoppingListMutations {
  const { client } = injectEmporix();
  const b = writeBundle([["emporix", "shopping-lists"]]);
  return {
    isPending: b.isPending,
    error: b.error,
    create: (draft) => b.write((ctx) => client.shoppingLists.create(draft, ctx)),
    remove: (v) =>
      b.write((ctx) =>
        client.shoppingLists.delete(v.customerId, ctx, v.name !== undefined ? { name: v.name } : {}),
      ),
    addItem: (v) =>
      b.write((ctx) => client.shoppingLists.addItem(v.customerId, v.listName, v.item, ctx)),
    removeItem: (v) =>
      b.write((ctx) =>
        client.shoppingLists.removeItem(v.customerId, v.listName, v.productId, ctx),
      ),
    setItemQuantity: (v) =>
      b.write((ctx) =>
        client.shoppingLists.setItemQuantity(
          v.customerId,
          v.listName,
          v.productId,
          v.quantity,
          ctx,
        ),
      ),
  };
}
```

Define `const SHOPPING_LIST_STALE = 30_000;` at the top of the file, matching React's `SHOPPING_LIST_STALE_TIME`.

- [ ] **Step 4: Add the smoke row and the mock**

```ts
// customerReads
{ name: "injectShoppingLists", resource: "shopping-lists", run: () => I.injectShoppingLists(), called: () => client.shoppingLists.list },
```

Mock: `shoppingLists: { list: vi.fn(async () => []), create: vi.fn(async () => ({ id: "l1" })), delete: fn(), addItem: fn(), removeItem: fn(), setItemQuantity: fn() }`.

- [ ] **Step 5: Run the tests**

Run: `pnpm -F @viu/emporix-sdk-angular test`
Expected: PASS, 195 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/angular
git commit -m "feat(angular): add shopping list reads and mutations"
```

---

## Phase 6 — Loyalty and after-sales

### Task 9: Reward points

**Files:**
- Create: `packages/angular/src/injectables/loyalty.ts`
- Modify: `packages/angular/src/injectables/index.ts`
- Modify: `packages/angular/tests/injectables-smoke.test.ts`

**Interfaces:**
- Produces: `injectMyRewardPoints`, `injectMyRewardPointsSummary`, `injectRedeemOptions`, `injectRewardPointMutations`

- [ ] **Step 1: Write the failing smoke rows**

All three reads are customer-scoped, so they go in `customerReads` — which asserts both halves: nothing for a guest, a request once signed in.

```ts
{ name: "injectMyRewardPoints", resource: "reward-points", run: () => I.injectMyRewardPoints(), called: () => client.rewardPoints.getMyPoints },
{ name: "injectMyRewardPointsSummary", resource: "reward-points-summary", run: () => I.injectMyRewardPointsSummary(), called: () => client.rewardPoints.getMySummary },
{ name: "injectRedeemOptions", resource: "reward-redeem-options", run: () => I.injectRedeemOptions(), called: () => client.rewardPoints.listRedeemOptions },
```

Mock: `rewardPoints: { getMyPoints: fn(), getMySummary: fn(), listRedeemOptions: vi.fn(async () => []), redeemMyPoints: fn() }`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-angular test -- injectables-smoke`
Expected: FAIL — three `is not a function` errors.

- [ ] **Step 3: Write the implementation**

All three reads take no parameters, so they share one shape:

```ts
const REWARD_STALE = 60_000;

/** The signed-in customer's reward-point balance. */
export function injectMyRewardPoints(
  opts: { enabled?: boolean } = {},
): CreateQueryResult<RewardPoints> {
  const { client } = injectEmporix();
  return injectEmporixQuery<RewardPoints, readonly []>(
    () => ({
      resource: "reward-points",
      args: [] as const,
      site: "none",
      mode: "customer",
      enabled: opts.enabled ?? true,
      queryFn: (ctx) => client.rewardPoints.getMyPoints(ctx),
      staleTime: REWARD_STALE,
    }),
    {},
  );
}
```

| Function | resource | queryFn | Returns |
|---|---|---|---|
| `injectMyRewardPointsSummary` | `reward-points-summary` | `client.rewardPoints.getMySummary(ctx)` | `Awaited<ReturnType<typeof client.rewardPoints.getMySummary>>` |
| `injectRedeemOptions` | `reward-redeem-options` | `client.rewardPoints.listRedeemOptions(ctx)` | `Awaited<ReturnType<typeof client.rewardPoints.listRedeemOptions>>` |

Both use `site: "none"`, `mode: "customer"`, `staleTime: REWARD_STALE`, `args: [] as const`.

```ts
export interface EmporixRewardPointMutations {
  isPending: Signal<boolean>;
  error: Signal<Error | null>;
  redeem: (input: RedeemMyPointsInput) => Promise<RedeemCouponResult>;
}

export function injectRewardPointMutations(): EmporixRewardPointMutations {
  const { client } = injectEmporix();
  const b = writeBundle([
    ["emporix", "reward-points"],
    ["emporix", "reward-points-summary"],
  ]);
  return {
    isPending: b.isPending,
    error: b.error,
    redeem: (input) => b.write((ctx) => client.rewardPoints.redeemMyPoints(input, ctx)),
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm -F @viu/emporix-sdk-angular test`
Expected: PASS, 201 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/angular
git commit -m "feat(angular): add reward point reads and redemption"
```

### Task 10: Returns and coupons

**Files:**
- Create: `packages/angular/src/injectables/returns.ts`
- Modify: `packages/angular/src/injectables/loyalty.ts` (coupons live with reward points — both are promotion-side writes against the same cart)
- Modify: `packages/angular/src/injectables/index.ts`
- Modify: `packages/angular/tests/injectables-smoke.test.ts`

**Interfaces:**
- Produces: `injectMyReturns`, `injectReturn`, `injectReturnMutations`, `injectCouponMutations`

- [ ] **Step 1: Write the failing smoke rows**

```ts
// customerReads
{ name: "injectMyReturns", resource: "returns", run: () => I.injectMyReturns(signal({})), called: () => client.returns.listReturns },
{ name: "injectReturn", resource: "return", run: () => I.injectReturn(signal("r1")), called: () => client.returns.getReturn },
```

Mock: `returns: { listReturns: vi.fn(async () => []), getReturn: fn(), createReturn: vi.fn(async () => ({ id: "r1" })) }` and `coupons: { validateCoupon: fn(), redeemCoupon: vi.fn(async () => ({ id: "red1" })) }`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-angular test -- injectables-smoke`
Expected: FAIL — two `is not a function` errors.

- [ ] **Step 3: Write the returns implementation**

```ts
const RETURNS_STALE = 30_000;

/** The signed-in customer's returns. */
export function injectMyReturns(
  query: Signal<Record<string, string | number>>,
  opts: { enabled?: boolean } = {},
): CreateQueryResult<Return[]> {
  const { client } = injectEmporix();
  return injectEmporixQuery<Return[], readonly [Record<string, string | number>]>(
    () => ({
      resource: "returns",
      args: [query()] as const,
      site: "none",
      mode: "customer",
      enabled: opts.enabled ?? true,
      queryFn: (ctx) => client.returns.listReturns(query(), ctx),
      staleTime: RETURNS_STALE,
    }),
    {},
  );
}
```

`injectReturn` follows the id-gated shape from Task 3: resource `return`, `mode: "customer"`, `site: "none"`, `queryFn: (ctx) => client.returns.getReturn(returnId() as string, ctx)`, gated on `(returnId() ?? "") !== ""`.

```ts
export function injectReturnMutations(): EmporixReturnMutations {
  const { client } = injectEmporix();
  const b = writeBundle([["emporix", "returns"], ["emporix", "return"]]);
  return {
    isPending: b.isPending,
    error: b.error,
    create: (input) => b.write((ctx) => client.returns.createReturn(input, ctx)),
  };
}
```

- [ ] **Step 4: Write the coupon implementation**

```ts
/**
 * Coupon validate and redeem.
 *
 * Both are writes even though «validate» reads like a query: Emporix records the
 * attempt against the redemption, so a cached answer would be wrong and a
 * re-render must not repeat it.
 */
export interface EmporixCouponMutations {
  isPending: Signal<boolean>;
  error: Signal<Error | null>;
  validate: (vars: { code: string; redemption: CouponRedemption }) => Promise<void>;
  redeem: (vars: { code: string; redemption: CouponRedemption }) => Promise<RedemptionCreated>;
}

export function injectCouponMutations(): EmporixCouponMutations {
  const { client } = injectEmporix();
  const b = writeBundle([["emporix", "cart"], ["emporix", "cart-items"]]);
  return {
    isPending: b.isPending,
    error: b.error,
    validate: (v) => b.write((ctx) => client.coupons.validateCoupon(v.code, v.redemption, ctx)),
    redeem: (v) => b.write((ctx) => client.coupons.redeemCoupon(v.code, v.redemption, ctx)),
  };
}
```

Take `CouponRedemption` from the SDK's exported type for `coupons.redeemCoupon`'s second parameter via `Parameters<…>[1]` rather than restating the shape.

- [ ] **Step 5: Run the tests**

Run: `pnpm -F @viu/emporix-sdk-angular test`
Expected: PASS, 205 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/angular
git commit -m "feat(angular): add return reads, return creation and coupon actions"
```

---

## Phase 7 — Segments

### Task 11: The seven segment reads

**Files:**
- Create: `packages/angular/src/injectables/segments.ts`
- Modify: `packages/angular/src/injectables/index.ts`
- Modify: `packages/angular/tests/injectables-smoke.test.ts`
- Modify: `docs/angular.md` (record the key deviation)

**Interfaces:**
- Produces: `injectMySegments`, `injectMySegmentItems`, `injectMySegmentProducts`, `injectMySegmentProductsInfinite`, `injectMySegmentCategories`, `injectMySegmentCategoriesInfinite`, `injectMySegmentCategoryTree`

- [ ] **Step 1: Write the failing smoke rows**

```ts
// customerReads
{ name: "injectMySegments", resource: "segments", run: () => I.injectMySegments(signal({})), called: () => client.segments.list },
{ name: "injectMySegmentItems", resource: "segment-items", run: () => I.injectMySegmentItems(signal({})), called: () => client.segments.listItems },
{ name: "injectMySegmentProducts", resource: "segment-products", run: () => I.injectMySegmentProducts(signal({})), called: () => client.segments.listMyProducts },
{ name: "injectMySegmentProductsInfinite", resource: "segment-products-infinite", run: () => I.injectMySegmentProductsInfinite(signal({}), signal(10)), called: () => client.segments.listMyProducts },
{ name: "injectMySegmentCategories", resource: "segment-categories", run: () => I.injectMySegmentCategories(signal({})), called: () => client.segments.listMyCategories },
{ name: "injectMySegmentCategoriesInfinite", resource: "segment-categories-infinite", run: () => I.injectMySegmentCategoriesInfinite(signal({}), signal(10)), called: () => client.segments.listMyCategories },
{ name: "injectMySegmentCategoryTree", resource: "segment-category-tree", run: () => I.injectMySegmentCategoryTree(signal({})), called: () => client.segments.getCategoryTree },
```

Mock: `segments: { list: vi.fn(async () => []), listItems: vi.fn(async () => []), listMyProducts: listFn(), listMyCategories: listFn(), getCategoryTree: vi.fn(async () => ({ children: [] })) }`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-angular test -- injectables-smoke`
Expected: FAIL — seven `is not a function` errors.

- [ ] **Step 3: Write the five plain reads**

Every one takes a query signal and nothing else. Shape:

```ts
// 5 minutes: segment membership is admin-driven, not shopper-driven.
const SEGMENTS_STALE = 5 * 60_000;

/** Segments the signed-in customer belongs to (`segment_read_own`). */
export function injectMySegments(
  query: Signal<{ q?: string; pageNumber?: number; pageSize?: number }>,
  opts: { enabled?: boolean } = {},
): CreateQueryResult<Segment[]> {
  const { client } = injectEmporix();
  return injectEmporixQuery<Segment[], readonly [object]>(
    () => ({
      resource: "segments",
      args: [query()] as const,
      site: "full",
      mode: "customer",
      enabled: opts.enabled ?? true,
      queryFn: (ctx) => client.segments.list(query(), ctx),
      staleTime: SEGMENTS_STALE,
    }),
    {},
  );
}
```

| Function | resource | queryFn | Returns |
|---|---|---|---|
| `injectMySegmentItems` | `segment-items` | `client.segments.listItems(query(), ctx)` | `SegmentItem[]` |
| `injectMySegmentProducts` | `segment-products` | `client.segments.listMyProducts(query(), ctx)` | `PaginatedItems<Product>` |
| `injectMySegmentCategories` | `segment-categories` | `client.segments.listMyCategories(query(), ctx)` | `PaginatedItems<Category>` |
| `injectMySegmentCategoryTree` | `segment-category-tree` | `client.segments.getCategoryTree(query(), ctx)` | `SegmentCategoryTree` |

All four: `site: "full"`, `mode: "customer"`, `staleTime: SEGMENTS_STALE`, `args: [query()] as const`.

- [ ] **Step 4: Write the two infinite reads**

```ts
export function injectMySegmentProductsInfinite(
  query: Signal<{ q?: string; siteCode?: string; legalEntityId?: string; onlyActive?: boolean }>,
  pageSize: Signal<number>,
  opts: { enabled?: boolean } = {},
): CreateInfiniteQueryResult<PaginatedItems<Product>> {
  const { client } = injectEmporix();
  return injectEmporixInfinite<Product>(
    () => ({
      resource: "segment-products-infinite",
      args: [query(), pageSize()] as const,
      site: "full",
      mode: "customer",
      enabled: opts.enabled ?? true,
      fetchPage: (pageNumber, ctx) =>
        client.segments.listMyProducts({ ...query(), pageNumber, pageSize: pageSize() }, ctx),
      staleTime: SEGMENTS_STALE,
    }),
    {},
  );
}
```

`injectMySegmentCategoriesInfinite` is the same with resource `segment-categories-infinite` and `client.segments.listMyCategories`.

- [ ] **Step 5: Record the key deviation in the docs**

Add to `docs/angular.md`, in the section that claims byte-identical keys:

> The seven segment reads are the one exception to key parity. React's segment hooks hand-roll `["emporix", "segment", "list", …]` instead of calling `emporixKey`; these route through the shared builder like every other read here, so their keys are `["emporix", "segments", …]`. Fixing the React side is the way to close this, not un-fixing this one.

- [ ] **Step 6: Run the tests**

Run: `pnpm -F @viu/emporix-sdk-angular test`
Expected: PASS, 219 tests (seven rows × two assertions in `customerReads`).

- [ ] **Step 7: Commit**

```bash
git add packages/angular docs/angular.md
git commit -m "feat(angular): add the seven segment read injectables"
```

---

## Phase 8 — Approvals, cloud functions, session attributes

### Task 12: Approvals

**Files:**
- Create: `packages/angular/src/injectables/approvals.ts`
- Modify: `packages/angular/src/injectables/index.ts`
- Modify: `packages/angular/tests/injectables-smoke.test.ts`

**Interfaces:**
- Produces: `injectApprovals`, `injectApproval`, `injectApprovalMutations`

- [ ] **Step 1: Write the failing smoke rows**

```ts
// customerReads
{ name: "injectApprovals", resource: "approvals", run: () => I.injectApprovals(signal({})), called: () => client.approvals.listApprovals },
{ name: "injectApproval", resource: "approval", run: () => I.injectApproval(signal("ap1")), called: () => client.approvals.getApproval },
```

Mock: `approvals: { listApprovals: vi.fn(async () => ({ items: [] })), getApproval: fn(), createApproval: vi.fn(async () => ({ id: "ap1" })), updateApproval: fn() }`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-angular test -- injectables-smoke`
Expected: FAIL — two `is not a function` errors.

- [ ] **Step 3: Write the implementation**

`injectApprovals` follows the query-signal shape from Task 11 (resource `approvals`, `mode: "customer"`, `site: "none"`, `client.approvals.listApprovals(query(), ctx)`). `injectApproval` follows the id-gated shape from Task 3 (resource `approval`, `client.approvals.getApproval(id() as string, ctx)`).

```ts
export interface EmporixApprovalMutations {
  isPending: Signal<boolean>;
  error: Signal<Error | null>;
  create: (input: ApprovalInput) => Promise<ApprovalCreated>;
  update: (vars: { approvalId: string; ops: ApprovalUpdateOps }) => Promise<void>;
}

export function injectApprovalMutations(): EmporixApprovalMutations {
  const { client } = injectEmporix();
  const b = writeBundle([["emporix", "approvals"], ["emporix", "approval"]]);
  return {
    isPending: b.isPending,
    error: b.error,
    create: (input) => b.write((ctx) => client.approvals.createApproval(input, ctx)),
    update: (v) => b.write((ctx) => client.approvals.updateApproval(v.approvalId, v.ops, ctx)),
  };
}
```

Derive `ApprovalUpdateOps` as `Parameters<typeof client.approvals.updateApproval>[1]`.

- [ ] **Step 4: Run the tests**

Run: `pnpm -F @viu/emporix-sdk-angular test`
Expected: PASS, 223 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/angular
git commit -m "feat(angular): add approval reads and mutations"
```

### Task 13: Cloud functions and session attributes

**Files:**
- Create: `packages/angular/src/injectables/cloud-functions.ts`, `packages/angular/src/injectables/session-attributes.ts`
- Modify: `packages/angular/src/injectables/index.ts`
- Modify: `packages/angular/tests/injectables-smoke.test.ts`

**Interfaces:**
- Produces: `injectCloudFunction`, `injectCloudFunctions`, `injectSessionAttributeMutations`

- [ ] **Step 1: Write the failing test**

The session-attribute bundle is the only injectable in the package that is **anonymous** rather than customer-scoped, matching React. That is worth its own assertion, not a smoke row:

```ts
it("session attributes are written with an anonymous context", async () => {
  boot(false);
  const m = TestBed.runInInjectionContext(() => I.injectSessionAttributeMutations());
  await m.add({ name: "channel", value: "web" } as never);
  expect(client.sessionContext.addAttribute).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ kind: "anonymous" }),
  );
});
```

Plus a smoke row for the read:

```ts
// guestReads
{ name: "injectCloudFunction", resource: "cloud-function", run: () => I.injectCloudFunction(signal("fn1")), called: () => client.cloudFunctions.invoke },
```

Mock: `cloudFunctions: { invoke: fn() }`, and add `addAttribute: fn(), removeAttribute: fn()` to the existing `sessionContext` mock.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-angular test`
Expected: FAIL — both new symbols missing.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Invokes a cloud function as a read.
 *
 * Unlike React's hook this takes no per-call `staleTime`: the `["emporix"]`
 * default of 30 s applies. A per-function cache lifetime is additive to add if
 * a consumer ever needs one.
 */
export function injectCloudFunction<TRes = unknown>(
  functionId: Signal<string | undefined>,
  options: Signal<InvokeCloudFunctionOptions> = signal({}),
  opts: { enabled?: boolean } = {},
): CreateQueryResult<TRes> {
  const { client } = injectEmporix();
  return injectEmporixQuery<TRes, readonly [string, object]>(
    () => ({
      resource: "cloud-function",
      args: [functionId() ?? "", options()] as const,
      site: "none",
      mode: "read-auth",
      enabled: (opts.enabled ?? true) && (functionId() ?? "") !== "",
      queryFn: (ctx) => client.cloudFunctions.invoke(functionId() as string, options(), ctx),
      staleTime: 30_000,
    }),
    {},
  );
}

export function injectCloudFunctions(): EmporixCloudFunctionMutations {
  const { client } = injectEmporix();
  // No invalidation: a cloud function's effects are opaque to this package, so
  // there is no key it could honestly claim went stale.
  const b = writeBundle([]);
  return {
    isPending: b.isPending,
    error: b.error,
    invoke: (v) => b.write((ctx) => client.cloudFunctions.invoke(v.functionId, v.options, ctx)),
  };
}

export function injectSessionAttributeMutations(): EmporixSessionAttributeMutations {
  const { client } = injectEmporix();
  const b = writeBundle([["emporix", "session-context"]]);
  return {
    isPending: b.isPending,
    error: b.error,
    // Anonymous by design, matching React: the session context belongs to the
    // browser session, not to a signed-in customer.
    add: (attribute) => b.write(() => client.sessionContext.addAttribute(attribute, auth.anonymous())),
    remove: (name) => b.write(() => client.sessionContext.removeAttribute(name, auth.anonymous())),
  };
}
```

Confirm `cloudFunctions.invoke`'s parameter order against `packages/sdk/src/services/cloud-functions.ts` before writing both call sites — React's hooks wrap it through a helper, so the direct signature has not been read here.

- [ ] **Step 4: Run the tests**

Run: `pnpm -F @viu/emporix-sdk-angular test`
Expected: PASS, 226 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/angular
git commit -m "feat(angular): add cloud function and session attribute injectables"
```

---

## Phase 9 — B2B company context

This phase is the only one that is design work rather than a port. Read it whole before starting Task 14.

### Design: the company context

React holds the active legal entity in a `CompanyContextProvider` and exposes it through `useActiveCompany` / `useCompanySwitcher`. The Angular equivalent mirrors the site context, which already solved the same problem: a piece of ambient state that queries key on, plus a switch operation with side effects beyond setting a value.

The contract, ported from `packages/react/src/company-context.types.ts`:

```ts
export type CompanyMode = "b2c" | "b2b" | "unresolved";

export interface EmporixCompanyState {
  /** Active legal entity. `null` = B2C mode. */
  activeCompany: Signal<LegalEntity | null>;
  /** Every legal entity the customer is assigned to. */
  myCompanies: Signal<readonly LegalEntity[]>;
  /**
   * `b2b` = a company is active; `b2c` = none active and at most one available;
   * `unresolved` = several available and none picked — the storefront must
   * render a picker rather than guess.
   */
  mode: Signal<CompanyMode>;
  status: Signal<"idle" | "loading" | "switching" | "error">;
  error: Signal<unknown>;
}

export interface EmporixCompanySwitch {
  /**
   * Rescope the session to a legal entity, or to B2C with `null`.
   *
   * Order matters: refresh the customer token with the new `legalEntityId` so
   * the server-side scope changes, drop the cart id because the old cart belongs
   * to the old scope, then invalidate. Falls back to a local-state-only update
   * when no refresh token is in storage — a fresh load with memory storage has
   * nothing to refresh with, and failing the switch outright would be worse
   * than a scope that is right in the UI and wrong on the next request.
   */
  setActiveCompany: (legalEntityId: string | null) => Promise<void>;
  refetchMyCompanies: () => Promise<void>;
  isSwitching: Signal<boolean>;
  switchError: Signal<Error | null>;
}
```

Three decisions carried over from the site context, for the same reasons:

1. **Two injectables, not one.** `injectActiveCompany` is read-only and safe to call anywhere; `injectCompanySwitch` is the write side. A component that only displays the company name cannot accidentally hold a switch function.
2. **`EMPORIX_COMPANY_INTERNAL` is not exported from the package root.** The writable signals live behind it so nobody sets `activeCompany` directly and skips the token rescope and the cart drop.
3. **Optimistic switch with a race guard.** Set the value, then run the effects; if a second switch landed first, abandon — `if (activeCompany()?.id !== legalEntityId) return;` after each await, exactly as `site-switch.ts` compares the site code it was issued for.

### Task 14: Company state and `injectActiveCompany`

**Files:**
- Create: `packages/angular/src/company.ts`
- Create: `packages/angular/tests/company.test.ts`
- Modify: `packages/angular/src/tokens.ts` (add `EMPORIX_COMPANY`, `EMPORIX_COMPANY_INTERNAL`)
- Modify: `packages/angular/src/provide.ts` (create the state; add `initialLegalEntityId?: string` to `EmporixConfig`)
- Modify: `packages/angular/src/index.ts` (export `injectActiveCompany`, `EMPORIX_COMPANY`, the types — **not** `EMPORIX_COMPANY_INTERNAL`)

**Interfaces:**
- Produces: `createCompanyState(...)`, `injectActiveCompany(): EmporixCompanyState`, `EmporixCompanyState`, `CompanyMode`
- Consumed by: Tasks 15, 16, 17

- [ ] **Step 1: Write the failing test**

Create `packages/angular/tests/company.test.ts`:

```ts
describe("injectActiveCompany", () => {
  it("is b2c for a guest and issues no request", () => {
    boot(false);
    const c = TestBed.runInInjectionContext(() => injectActiveCompany());
    expect(c.mode()).toBe("b2c");
    expect(c.activeCompany()).toBeNull();
    expect(client.companies.listMine).not.toHaveBeenCalled();
  });

  it("is b2c when the customer has exactly one company and none is active", async () => {
    boot(true);
    client.companies.listMine = vi.fn(async () => [{ id: "le1" }]) as never;
    const c = TestBed.runInInjectionContext(() => injectActiveCompany());
    await settleUntil(() => expect(c.myCompanies().length).toBe(1));
    expect(c.mode()).toBe("b2c");
  });

  it("is unresolved when several companies exist and none is active", async () => {
    boot(true);
    client.companies.listMine = vi.fn(async () => [{ id: "le1" }, { id: "le2" }]) as never;
    const c = TestBed.runInInjectionContext(() => injectActiveCompany());
    await settleUntil(() => expect(c.mode()).toBe("unresolved"));
  });

  it("is b2b when a stored legal entity id matches one of them", async () => {
    boot(true);
    storage.setActiveLegalEntityId("le2");
    client.companies.listMine = vi.fn(async () => [{ id: "le1" }, { id: "le2" }]) as never;
    const c = TestBed.runInInjectionContext(() => injectActiveCompany());
    await settleUntil(() => expect(c.mode()).toBe("b2b"));
    expect(c.activeCompany()?.id).toBe("le2");
  });
});
```

The `unresolved` case is the one that earns this test file: a storefront that guesses a company when the customer has two is a storefront that shows the wrong prices to a B2B buyer.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-angular test -- company`
Expected: FAIL — cannot resolve `injectActiveCompany`.

- [ ] **Step 3: Add the tokens**

In `src/tokens.ts`, mirroring the site tokens exactly, including the comment explaining why the internal one is not exported from the index:

```ts
export const EMPORIX_COMPANY = new InjectionToken<EmporixCompanyState>("EMPORIX_COMPANY");
/**
 * The writable side. Deliberately not exported from `index.ts`: setting
 * `activeCompany` directly skips the token rescope and the cart drop, which is
 * exactly the bug `setActiveCompany` exists to prevent.
 */
export const EMPORIX_COMPANY_INTERNAL = new InjectionToken<EmporixCompanyInternal>(
  "EMPORIX_COMPANY_INTERNAL",
);
```

- [ ] **Step 4: Write `createCompanyState` and `injectActiveCompany`**

Resolution order, matching React and the site state: explicit `initialLegalEntityId` → storage (`emporix.activeLegalEntityId`) → `null`. Then, when a customer token is present, one fetch of `companies.listMine` fills `myCompanies` and resolves `activeCompany` by id. Derive `mode` rather than storing it:

```ts
const mode = computed<CompanyMode>(() => {
  if (activeCompany() !== null) return "b2b";
  return myCompanies().length > 1 ? "unresolved" : "b2c";
});
```

Guest handling is the `mode: "customer"` rule again: no token, no request, `mode` stays `b2c`.

- [ ] **Step 5: Wire it into `provideEmporix`**

Add `initialLegalEntityId?: string` to `EmporixConfig` with the same doc-comment style as `initialSiteCode` («Order: this → storage → null»), and provide both tokens next to the site ones.

- [ ] **Step 6: Run the tests**

Run: `pnpm -F @viu/emporix-sdk-angular test`
Expected: PASS, 230 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/angular
git commit -m "feat(angular): add the company context state and injectActiveCompany"
```

### Task 15: `injectCompanySwitch`

**Files:**
- Create: `packages/angular/src/company-switch.ts`
- Create: `packages/angular/tests/company-switch.test.ts`
- Modify: `packages/angular/src/index.ts`

**Interfaces:**
- Consumes: `EMPORIX_COMPANY_INTERNAL` from Task 14
- Produces: `injectCompanySwitch(): EmporixCompanySwitch`

- [ ] **Step 1: Write the failing test**

```ts
describe("injectCompanySwitch", () => {
  it("refreshes the token with the legal entity, drops the cart and invalidates", async () => {
    boot(true);
    storage.setRefreshToken("r1");
    storage.setCartId("cart-1");
    const spy = vi.spyOn(qc, "invalidateQueries");
    const s = TestBed.runInInjectionContext(() => injectCompanySwitch());
    await s.setActiveCompany("le2");
    expect(client.customers.refresh).toHaveBeenCalledWith(
      expect.objectContaining({ legalEntityId: "le2" }),
    );
    expect(storage.getCartId()).toBeNull();
    expect(spy).toHaveBeenCalled();
  });

  it("falls back to local state only when no refresh token is stored", async () => {
    boot(true);
    const s = TestBed.runInInjectionContext(() => injectCompanySwitch());
    await s.setActiveCompany("le2");
    expect(client.customers.refresh).not.toHaveBeenCalled();
    expect(s.switchError()).toBeNull();
    expect(TestBed.runInInjectionContext(() => injectActiveCompany()).activeCompany()?.id).toBe("le2");
  });

  it("abandons a switch that a later switch overtook", async () => {
    boot(true);
    storage.setRefreshToken("r1");
    let release: () => void = () => undefined;
    client.customers.refresh = vi.fn(
      () => new Promise((r) => (release = () => r({}))),
    ) as never;
    const s = TestBed.runInInjectionContext(() => injectCompanySwitch());
    const first = s.setActiveCompany("le1");
    await s.setActiveCompany(null);
    release();
    await first;
    expect(
      TestBed.runInInjectionContext(() => injectActiveCompany()).activeCompany(),
    ).toBeNull();
  });

  it("records a failed refresh on switchError and does not drop the cart", async () => {
    boot(true);
    storage.setRefreshToken("r1");
    storage.setCartId("cart-1");
    client.customers.refresh = vi.fn(async () => {
      throw new Error("401");
    }) as never;
    const s = TestBed.runInInjectionContext(() => injectCompanySwitch());
    await s.setActiveCompany("le2");
    expect(s.switchError()?.message).toBe("401");
    expect(storage.getCartId()).toBe("cart-1");
  });
});
```

The third test is the race guard and the fourth is the failure path. Both were bugs in the site switch that only a test found; the company switch has the same shape, so it gets the same two tests up front.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-angular test -- company-switch`
Expected: FAIL — cannot resolve `injectCompanySwitch`.

- [ ] **Step 3: Write the implementation**

Sequence, in this order: set `isSwitching`, clear `switchError`, set the optimistic value, persist to storage, then — only when a refresh token exists — `client.customers.refresh({ legalEntityId })`, drop the cart id, invalidate `["emporix"]`. Re-check `activeCompany()?.id` against the requested id after each await and return early if it changed. On error, set `switchError` and leave the cart id alone; do not roll the value back, matching `site-switch.ts` (a rollback fights the user's next click).

- [ ] **Step 4: Run the tests**

Run: `pnpm -F @viu/emporix-sdk-angular test`
Expected: PASS, 234 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/angular
git commit -m "feat(angular): add the company switch with token rescope and cart drop"
```

### Task 16: The five company reads

**Files:**
- Create: `packages/angular/src/injectables/companies.ts`
- Modify: `packages/angular/src/injectables/index.ts`
- Modify: `packages/angular/tests/injectables-smoke.test.ts`

**Interfaces:**
- Produces: `injectMyCompanies`, `injectCompany`, `injectCompanyContacts`, `injectCompanyGroups`, `injectCompanyLocations`

- [ ] **Step 1: Write the failing smoke rows**

All five are customer-scoped:

```ts
// customerReads
{ name: "injectMyCompanies", resource: "my-companies", run: () => I.injectMyCompanies(), called: () => client.companies.listMine },
{ name: "injectCompany", resource: "company", run: () => I.injectCompany(signal("le1")), called: () => client.companies.get },
{ name: "injectCompanyContacts", resource: "company-contacts", run: () => I.injectCompanyContacts(signal("le1")), called: () => client.contacts.listForCompany },
{ name: "injectCompanyGroups", resource: "company-groups", run: () => I.injectCompanyGroups(signal("le1")), called: () => client.customerGroups.listForCompany },
{ name: "injectCompanyLocations", resource: "company-locations", run: () => I.injectCompanyLocations(signal("le1")), called: () => client.locations.listForCompany },
```

Mock: `companies: { listMine: vi.fn(async () => []), get: fn(), create: vi.fn(async () => ({ id: "le1" })), update: fn(), delete: fn() }`, `contacts: { listForCompany: vi.fn(async () => []), assign: fn(), unassign: fn(), update: fn() }`, `locations: { listForCompany: vi.fn(async () => []), create: vi.fn(async () => ({ id: "loc1" })), update: fn(), delete: fn() }`, `customerGroups: { listForCompany: vi.fn(async () => []), addMember: fn(), removeMember: fn() }`.

Note React keys all four company reads under the single resource `companies`; these use distinct resources so one company's contacts do not invalidate another's locations. Distinct keys are the correct choice and the reason this is not a 1:1 port.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-angular test -- injectables-smoke`
Expected: FAIL — five `is not a function` errors.

- [ ] **Step 3: Write the implementations**

`injectMyCompanies` takes no parameters (`args: [] as const`, resource `my-companies`). The other four are id-gated and follow the shape from Task 3:

| Function | Params | resource | queryFn | Returns |
|---|---|---|---|---|
| `injectCompany` | `legalEntityId: Signal<string \| undefined>` | `company` | `client.companies.get(id, ctx)` | `LegalEntity` |
| `injectCompanyContacts` | `legalEntityId: Signal<string \| undefined>` | `company-contacts` | `client.contacts.listForCompany(id, ctx)` | `ContactAssignment[]` |
| `injectCompanyGroups` | `legalEntityId: Signal<string \| undefined>` | `company-groups` | `client.customerGroups.listForCompany(id, ctx)` | `IamGroup[]` |
| `injectCompanyLocations` | `legalEntityId: Signal<string \| undefined>` | `company-locations` | `client.locations.listForCompany(id, ctx)` | `Location[]` |

All five: `mode: "customer"`, `site: "none"`, `staleTime: COMPANIES_STALE` (`60_000`).

- [ ] **Step 4: Run the tests**

Run: `pnpm -F @viu/emporix-sdk-angular test`
Expected: PASS, 244 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/angular
git commit -m "feat(angular): add the five company read injectables"
```

### Task 17: `injectCompanyMutations`

**Files:**
- Modify: `packages/angular/src/injectables/companies.ts`
- Create: `packages/angular/tests/company-mutations.test.ts`

**Interfaces:**
- Consumes: `writeBundle`
- Produces:
```ts
export interface EmporixCompanyMutations {
  isPending: Signal<boolean>;
  error: Signal<Error | null>;
  createCompany: (input: LegalEntityInput) => Promise<LegalEntity>;
  updateCompany: (vars: { id: string; patch: LegalEntityPatch }) => Promise<LegalEntity>;
  deleteCompany: (id: string) => Promise<void>;
  createLocation: (input: LocationInput) => Promise<Location>;
  updateLocation: (vars: { id: string; patch: LocationPatch }) => Promise<Location>;
  deleteLocation: (id: string) => Promise<void>;
  assignContact: (input: ContactAssignmentInput) => Promise<ContactAssignment>;
  updateContactAssignment: (vars: {
    id: string;
    patch: ContactAssignmentPatch;
  }) => Promise<ContactAssignment>;
  unassignContact: (id: string) => Promise<void>;
  addGroupMember: (vars: { groupId: string; member: GroupMemberInput }) => Promise<void>;
  removeGroupMember: (vars: { groupId: string; userId: string }) => Promise<void>;
}
export function injectCompanyMutations(): EmporixCompanyMutations
```

Derive every input and patch type with `Parameters<typeof client.…>[n]` rather than restating SDK shapes — `exactOptionalPropertyTypes` makes a hand-written copy diverge quietly.

- [ ] **Step 1: Write the failing test**

Eleven near-identical methods do not need eleven tests. Test the two things that can actually break — the invalidation set and the token gate — plus a table that every method is wired to the facade method it claims:

```ts
const methods: Array<[keyof EmporixCompanyMutations, () => unknown, () => Mock]> = [
  ["createCompany", () => m.createCompany({} as never), () => client.companies.create],
  ["updateCompany", () => m.updateCompany({ id: "le1", patch: {} as never }), () => client.companies.update],
  ["deleteCompany", () => m.deleteCompany("le1"), () => client.companies.delete],
  ["createLocation", () => m.createLocation({} as never), () => client.locations.create],
  ["updateLocation", () => m.updateLocation({ id: "loc1", patch: {} as never }), () => client.locations.update],
  ["deleteLocation", () => m.deleteLocation("loc1"), () => client.locations.delete],
  ["assignContact", () => m.assignContact({} as never), () => client.contacts.assign],
  ["updateContactAssignment", () => m.updateContactAssignment({ id: "c1", patch: {} as never }), () => client.contacts.update],
  ["unassignContact", () => m.unassignContact("c1"), () => client.contacts.unassign],
  ["addGroupMember", () => m.addGroupMember({ groupId: "g1", member: {} as never }), () => client.customerGroups.addMember],
  ["removeGroupMember", () => m.removeGroupMember({ groupId: "g1", userId: "u1" }), () => client.customerGroups.removeMember],
];

describe.each(methods)("injectCompanyMutations.%s", (_name, call, facade) => {
  it("calls its facade method and invalidates the company keys", async () => {
    boot(true);
    const spy = vi.spyOn(qc, "invalidateQueries");
    m = TestBed.runInInjectionContext(() => I.injectCompanyMutations());
    await call();
    expect(facade()).toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith({ queryKey: ["emporix", "my-companies"] });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-angular test -- company-mutations`
Expected: FAIL — `I.injectCompanyMutations is not a function`, 11 rows.

- [ ] **Step 3: Write the implementation**

One bundle, invalidating all five company resources, because these five reads are one aggregate: adding a location changes what `injectCompany` should show.

```ts
export function injectCompanyMutations(): EmporixCompanyMutations {
  const { client } = injectEmporix();
  const b = writeBundle([
    ["emporix", "my-companies"],
    ["emporix", "company"],
    ["emporix", "company-contacts"],
    ["emporix", "company-groups"],
    ["emporix", "company-locations"],
  ]);
  return {
    isPending: b.isPending,
    error: b.error,
    createCompany: (input) => b.write((ctx) => client.companies.create(input, ctx)),
    updateCompany: (v) => b.write((ctx) => client.companies.update(v.id, v.patch, ctx)),
    deleteCompany: (id) => b.write((ctx) => client.companies.delete(id, ctx)),
    createLocation: (input) => b.write((ctx) => client.locations.create(input, ctx)),
    updateLocation: (v) => b.write((ctx) => client.locations.update(v.id, v.patch, ctx)),
    deleteLocation: (id) => b.write((ctx) => client.locations.delete(id, ctx)),
    assignContact: (input) => b.write((ctx) => client.contacts.assign(input, ctx)),
    updateContactAssignment: (v) => b.write((ctx) => client.contacts.update(v.id, v.patch, ctx)),
    unassignContact: (id) => b.write((ctx) => client.contacts.unassign(id, ctx)),
    addGroupMember: (v) =>
      b.write((ctx) => client.customerGroups.addMember(v.groupId, v.member, ctx)),
    removeGroupMember: (v) =>
      b.write((ctx) => client.customerGroups.removeMember(v.groupId, v.userId, ctx)),
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm -F @viu/emporix-sdk-angular test`
Expected: PASS, 255 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/angular
git commit -m "feat(angular): add the company mutation bundle"
```

---

## Phase 10 — Release readiness

### Task 18: Prove two new areas in the demo

The package's rule so far has been that an injectable is not finished until something renders it — that is how `injectProductMedia` was caught calling a server-only endpoint and how the infinite factory's dropped `pageParam` surfaced. Two new routes cover the two riskiest additions: a mutation bundle and the company context.

**Files:**
- Create: `examples/angular-storefront-demo/src/app/pages/lists.ts` + `lists.html`
- Create: `examples/angular-storefront-demo/src/app/pages/company.ts` + `company.html`
- Modify: `examples/angular-storefront-demo/src/app/routes.ts`, `shell.html` (nav links)
- Modify: `examples/angular-storefront-demo/README.md`

Templates go in `.html` files — the demo has no inline templates left as of `92a124c`.

- [ ] **Step 1: Build the shopping-list route**

`/account/lists`: `injectShoppingLists()` for the table, `injectShoppingListMutations()` for create and remove. Render `isPending()` on the button and `error()?.message` in a notice, the way `product.html` already does for the cart.

- [ ] **Step 2: Build the company route**

`/account/company`: `injectActiveCompany()` for the current company and `mode()`, `injectCompanySwitch()` for the picker. Render all three modes explicitly — and render `unresolved` as an actual picker, because that is the state the design says a storefront must not guess its way out of.

- [ ] **Step 3: Verify the production build**

Run: `PATH=/opt/homebrew/opt/node/bin:$PATH pnpm -F @viu/emporix-examples-angular-storefront build:prod`
Expected: bundle generation complete; two new lazy chunks named `lists` and `company`.

- [ ] **Step 4: Verify against the live tenant**

Start the dev server, sign in with the test customer from `e2e/.env.local` — the password is typed by the human, never by the agent, and no credential is ever written into source or echoed to the terminal. Then confirm: the lists route renders and a created list appears without a manual reload, and the company route reports a mode consistent with what `companies.listMine` returns for that customer. Record what was observed, including a `b2c` result if the test customer has no company — «not exercised because the tenant has no B2B customer» is a finding, not a gap to paper over.

- [ ] **Step 5: Commit**

```bash
git add examples/angular-storefront-demo
git commit -m "feat(examples): add shopping list and company routes to the angular demo"
```

### Task 19: Documentation and changeset

**Files:**
- Modify: `docs/angular.md` (the scope table at line 336 is now wrong in both directions)
- Modify: `packages/angular/README.md`, `CLAUDE.md` (the workspace table's Angular row), `examples/README.md`
- Create: `.changeset/<name>.md`

- [ ] **Step 1: Replace the scope table**

The current text says the package ships 33 of React's 107 hooks and lists 69 as out of scope. Replace it with the measured parity statement: 107 React hooks map onto the Angular surface with no storefront gap, the mapping is not 1:1 because 31 write operations are grouped into 11 bundles, and the three deliberate deviations are listed with their reasons.

- [ ] **Step 2: Document the new areas**

One subsection each for shopping lists, loyalty, returns, segments, approvals, cloud functions, session attributes and B2B, each with a runnable example. The B2B one shows the three-mode branch, because a consumer who ignores `unresolved` ships the bug the mode exists to prevent.

- [ ] **Step 3: Write the changeset**

```bash
pnpm changeset
```

Minor for `@viu/emporix-sdk-angular`. Describe the user-visible effect: the package now covers the full storefront surface, the 11 mutation bundles, the B2B company context, and — called out explicitly because it is the one thing that would break an early adopter — the `injectProductSearch` / `injectProductNameSearch` rename from Task 1.

- [ ] **Step 4: Verify the whole workspace**

```bash
pnpm -r build && pnpm test && pnpm typecheck && pnpm lint
```
Expected: all four exit 0. `pnpm test` filters `./packages/*` — do not substitute `pnpm -r test`, which would run the e2e suite against the live tenant.

- [ ] **Step 5: Commit**

```bash
git add docs packages examples CLAUDE.md .changeset
git commit -m "docs(angular): record the parity surface and the deliberate deviations"
```

### Task 20: The Angular e2e job

The last open item from the original spec's phase 8: `e2e/playwright.config.ts:39` still boots `examples/vite-spa` only, so no browser has ever driven the Angular bindings in CI. Shipping a release whose only automated proof is unit tests with a mocked client is a decision, not an oversight — but it should be a stated one.

**Files:**
- Modify: `e2e/playwright.config.ts` (second `webServer` entry for the Angular demo)
- Create: `e2e/specs/angular-storefront.spec.ts`
- Modify: `.github/workflows/pr-check.yml`
- Modify: `docs/e2e.md`

- [ ] **Step 1: Add the second web server**

Add an entry booting `pnpm -F @viu/emporix-examples-angular-storefront start` on its own port, alongside the existing `vite-spa` one. The Angular demo gates on `localStorage` config, so the spec must seed tenant and client id via `addInitScript` before the first navigation — there is no build-time config to point it at a tenant.

- [ ] **Step 2: Write the smallest spec that would have caught a real bug**

Three assertions, each one a bug this project actually hit: the catalog renders more than zero cards (the `productMedia` field-name bug rendered cards with no image and would still pass a «page loaded» check), «Load more» yields a second page whose first item differs from the first page's (the dropped `pageParam`), and a signed-out visit to `/account` issues no orders request (the frozen-signal bug that kept showing a logged-out customer their own orders).

- [ ] **Step 3: Run it**

Run: `pnpm e2e -- angular-storefront`
Expected: PASS. Specs needing a customer skip without `EMPORIX_TEST_CUSTOMER_EMAIL` / `_PASSWORD` in `e2e/.env.local` — check the skip count, because a suite of skips looks a lot like a suite of passes.

- [ ] **Step 4: Wire it into CI**

Add the Angular spec to the e2e job, gated the same way the AOT builds are (`if: matrix.node != '20'`), since the Angular CLI rejects Node 20.

- [ ] **Step 5: Commit**

```bash
git add e2e .github docs/e2e.md
git commit -m "test(repo): drive the angular storefront in the e2e suite"
```

---

## Release gate

Before the release PR, all five must hold — with output, not assertion:

1. `pnpm -r build && pnpm test && pnpm typecheck && pnpm lint` all exit 0.
2. `pnpm -F @viu/emporix-sdk-angular test --coverage` ≥ 80 %.
3. `node packages/angular/scripts/check-dist.mjs` finds none of the four compiler markers.
4. Both AOT example builds complete: `angular-storefront` and `angular-storefront-demo`.
5. `gh pr checks 301` — every check green, not pending. A matrix left pending is not a pass.

## Decisions that are not mine

Three things this plan cannot settle:

- **PR size.** #301 already carries 26 commits and the SDK move. This plan adds ~20 more and roughly doubles the package. It is coherent as one release, and it is also the kind of PR nobody reviews line by line. Splitting Phase 9 (B2B) into its own PR would leave a releasable storefront package and defer the largest new design — that is the natural cut if one is wanted.
- **Whether Task 20 blocks the release.** It is the only end-to-end proof the bindings work in a browser. Shipping without it is defensible; shipping without deciding is not.
- **The React follow-ups.** The throw-on-logout in five hook families and the hand-rolled segment keys are real defects this work documents but does not fix. They belong in their own PR against `packages/react`.

## Self-review

**Spec coverage.** All 67 measured gaps are assigned: 8 catalog (Tasks 3–4), 5 small reads (Task 5), 5 orders (Task 6), 2 address tags (Task 7), 6 shopping lists (Task 8), 4 reward points (Task 9), 5 returns and coupons (Task 10), 7 segments (Task 11), 4 approvals (Task 12), 4 cloud functions and session attributes (Task 13), 17 B2B (Tasks 14–17). Sum: 8+5+5+2+6+4+5+7+4+4+17 = 67. ✓

**Placeholders.** None: every read is either written out or fully specified by a table row against a shape shown in the same task; every bundle is written out. Three tasks (4, 6, 13) carry an explicit «confirm this signature against the SDK source before writing» step — that is a verification instruction with a named file, not a deferred decision.

**Type consistency.** `writeBundle(keys)` → `{isPending, error, write}` is used with that exact shape in Tasks 6–17. `EmporixCompanyState` from Task 14 is consumed by Tasks 15–16 and the demo in Task 18. `injectProductNameSearch` / `injectProductSearch` keep the names Task 1 assigns in the smoke rows, the demo and the docs. The shopping-list bundle uses `remove`, not `delete`, consistently in its interface, its implementation and its demo route.
