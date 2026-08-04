# Category browsing in `next-server-first` — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** make every category of a tenant reachable in `examples/next-server-first`, with its products, from one cached `categories.tree()` call.

**Architecture:** one helper reads the tagged, hour-cached category tree and walks it in memory. `/categories` lists the roots, `/category/[id]` derives its breadcrumb and child tiles from the same walk. No second network call for hierarchy, because measurement showed there is no working second call.

**Tech Stack:** Next 16 App Router (Server Components only), `@viu/emporix-sdk-next`, `@viu/emporix-sdk`, vitest for the one pure function.

Spec: [`docs/superpowers/specs/2026-08-04-next-category-tree-design.md`](../specs/2026-08-04-next-category-tree-design.md)

## Global Constraints

- **Server Components only.** No `"use client"` in any file this plan creates. The demo's whole claim is that the browser makes no Emporix calls.
- **Catalog reads go through `getEmporixClient({ context: await siteContext() })`**, never `withEmporixSession*`. A read-only cookie handle cannot persist an anonymous session, so a session-bound catalog read logs in again on every render.
- **The header must keep making zero Emporix calls.** It gets a plain `<a>` and nothing else. That invariant has a README section and a measurement behind it.
- **Commitlint:** allowed scopes are `repo, release, sdk, react, core, customer, product, category, cart, checkout, payment, price, media, segment, availability, auth, http, logger, deps, docs, examples`. There is **no** `next` scope — use `repo` or `examples`. The first word after the scope must be a lowercase verb.
- **Examples typecheck against the built `dist/`.** After changing `packages/sdk`, run `pnpm -F @viu/emporix-sdk build` before typechecking the example.
- **`git push origin <branch>`** works (SSH). The `gh` CLI works for API calls. Never merge a PR unattended.

## Measured signatures — do not guess these

| What | Exact shape |
|---|---|
| `client.categories.tree(auth?)` | `Promise<Category[]>` **today**; Task 1 changes it to `Promise<CategoryNode[]>` |
| `client.categories.get(id, auth?)` | `Promise<Category>` |
| `client.categories.productsIn(id, { pageNumber?, pageSize? }, auth?)` | `Promise<{ items: Product[]; pageNumber: number; pageSize: number; hasNextPage: boolean }>` |
| `client.products.list({ pageNumber?, pageSize? }, auth?)` | `Promise<PaginatedItems<Product>>` — same four fields |
| `CategoryNode` | exported from `@viu/emporix-sdk`; alias of the generated `CategoryTree` |
| `CategoryTree` required fields | `id: string`, `name: string`, `localizedName: { [k: string]: string }`, `position: number`, `published: boolean` |
| `CategoryTree` optional fields used here | `subcategories?: Array<CategoryTree>`, `code?: string`, `description?: string` |
| `catLabel(c: unknown): string` | from `@viu/emporix-examples-shared`; prefers `localizedName`, falls back to `name`, `code`, `id` |
| `catId(c: unknown): string` | from `@viu/emporix-examples-shared` |
| `pricesFor(client, auth: AuthContext \| undefined, products: Product[])` | `Promise<(id: string) => PriceVM \| undefined>`, from `app/lib/prices.ts` |
| `ProductGrid` props | `{ products: Product[]; priceOf: (id: string) => PriceVM \| undefined }`, from `app/components/product-grid.tsx` |
| `siteContext()` | `Promise<{ siteCode: string; currency: string; targetLocation: string; language?: string }>`, from `app/lib/site-context.ts` |
| Tenant reality (measured 2026-08-04) | 21 roots, 1'631 nodes, 378 KiB, 282 ms; 16 roots childless; three roots named «Sports & Outdoor» with 30 leaves each, only `686435e9-6edc-4b5f-ba89-5f1a8caaf6ee` stocked |

## File structure

| File | Responsibility |
|---|---|
| Create `examples/next-server-first/app/lib/category-tree.ts` | the cached tree read and the pure walk — the only file that knows the tree shape |
| Create `examples/next-server-first/tests/category-tree.test.ts` | tests for the walk |
| Create `examples/next-server-first/app/categories/page.tsx` | the roots list |
| Modify `examples/next-server-first/app/category/[id]/page.tsx` | breadcrumb + tree children replace the dead assignments nav |
| Modify `examples/next-server-first/app/page.tsx` | all products instead of one hard-coded category |
| Modify `examples/next-server-first/app/components/header.tsx` | one `<a>` |
| Modify `examples/next-server-first/app/emporix.ts` | `PRICED_CATEGORY` keeps a comment saying why it survives |
| Modify `packages/sdk/src/services/category.ts` | `tree()` return type and doc comment |
| Modify `examples/next-server-first/README.md` | the dated verification table |

---

### Task 1: fix `categories.tree()`'s return type and doc comment

The example cannot read `node.subcategories` without a cast until this is right, so it comes first.

**Files:**
- Modify: `packages/sdk/src/services/category.ts` (the `tree()` method, around line 122-133)
- Create: `.changeset/sdk-category-tree-return-type.md`

**Interfaces:**
- Produces: `client.categories.tree(auth?): Promise<CategoryNode[]>` — every later task depends on this.

- [ ] **Step 1: Read the current method**

```bash
sed -n '120,135p' packages/sdk/src/services/category.ts
```

You will see the return type `Promise<Category[]>` and a doc comment ending «drill into a node's children with {@link subcategories}».

- [ ] **Step 2: Replace the method**

```ts
  /**
   * The catalogue's **root categories** — the published category trees
   * (`GET /category-trees`).
   *
   * Returns `CategoryNode[]` (the generated `CategoryTree`), not `Category[]`.
   * The two differ: `Category` carries `parentId` and no `subcategories`,
   * `CategoryTree` the reverse, and this endpoint answers with the latter.
   * Measured against a live tenant on 2026-08-04 — every node had
   * `subcategories` or nothing, none had `parentId`.
   *
   * **Children arrive inline in `subcategories`.** Do not reach for
   * {@link subcategories} to drill down: that method reads category-to-category
   * *assignments* (`/categories/{id}/assignments`), which is a different feature
   * and answered empty for every category on the tenant this was measured on.
   * {@link childCategories} hits `/categories/{id}/subcategories` and answers
   * **404** for a tree root. One call gives you the whole hierarchy.
   */
  async tree(auth: AuthContext = ANON): Promise<CategoryNode[]> {
    return this.ctx.http.request<CategoryNode[]>({
      method: "GET",
      path: `/category/${this.ctx.tenant}/category-trees`,
      auth,
    });
  }
```

- [ ] **Step 3: Typecheck the SDK**

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: clean. `CategoryNode` is already declared in this file (line 29) and needs no new import.

- [ ] **Step 4: Run the SDK tests**

Run: `pnpm -F @viu/emporix-sdk test`
Expected: 850 passed. A return-type change has no runtime effect; if a test fails, it asserted the wrong type and the failure is information — read it before changing it.

- [ ] **Step 5: Check nothing in the workspace relied on the wrong type**

```bash
pnpm -F @viu/emporix-sdk build && pnpm typecheck
```

Expected: all 11 projects clean. `packages/react`'s `useCategoryTree` infers its type from this method, and `storefront-demo`'s `CategoryNav` passes the nodes to `catId`/`catLabel`, which take `unknown` — so nothing should break. If something does, that call site was reading a field the payload never had, which is exactly what this fixes.

- [ ] **Step 6: Write the changeset**

`.changeset/sdk-category-tree-return-type.md`:

```markdown
---
"@viu/emporix-sdk": patch
---

`categories.tree()` now returns `CategoryNode[]` instead of `Category[]`.

The declared type was factually wrong. `/category-trees` answers with the
generated `CategoryTree` shape — measured against a live tenant on 2026-08-04,
every node carried `subcategories` or nothing, and none carried `parentId`:

| | `parentId` | `subcategories` |
|---|---|---|
| `Category` | yes | no |
| `CategoryTree` / `CategoryNode` | no | yes |

So reading a tree node's children needed a cast, and reading `parentId` off one
compiled and was always `undefined`. Type-only change, no runtime difference —
but code that read `parentId` from a tree node will now fail to compile, which is
the point.

The doc comment also pointed readers to `subcategories()` for drilling down. That
method reads category-to-category *assignments* and answered empty for every
category on the tenant this was measured on; `childCategories()` answers **404**
for a tree root. The children are inline in `subcategories`, and the comment now
says so.
```

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/services/category.ts .changeset/sdk-category-tree-return-type.md
git commit -m "fix(sdk): type categories.tree as CategoryNode array"
```

---

### Task 2: the tree helper and its tests

**Files:**
- Create: `examples/next-server-first/app/lib/category-tree.ts`
- Create: `examples/next-server-first/tests/category-tree.test.ts`

**Interfaces:**
- Consumes: `client.categories.tree(auth?): Promise<CategoryNode[]>` from Task 1; `getEmporixClient` from `@viu/emporix-sdk-next`; `siteContext()` from `app/lib/site-context.ts`.
- Produces:
  - `categoryTree(): Promise<CategoryNode[]>`
  - `interface FoundCategory { node: CategoryNode; ancestors: CategoryNode[] }`
  - `findCategory(roots: CategoryNode[], id: string): FoundCategory | null`

Tasks 3 and 4 import exactly these three names.

- [ ] **Step 1: Write the failing tests**

`examples/next-server-first/tests/category-tree.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { CategoryNode } from "@viu/emporix-sdk";
import { findCategory } from "../app/lib/category-tree";

/**
 * Shaped like the real thing: `id`, `name`, `localizedName`, `position` and
 * `published` are required on `CategoryTree`, so a fixture missing one does not
 * compile. The three-level nesting and the duplicate name are both taken from the
 * `viu` tenant — it has three roots called «Sports & Outdoor».
 */
function node(id: string, name: string, children?: CategoryNode[]): CategoryNode {
  return {
    id,
    name,
    localizedName: { en: name },
    position: 1,
    published: true,
    ...(children ? { subcategories: children } : {}),
  };
}

const TREE: CategoryNode[] = [
  node("fitness", "Fitness"),
  node("so-1", "Sports & Outdoor", [
    node("cycling", "Cycling", [node("helmets", "Bike Helmets & Protection")]),
  ]),
  node("so-2", "Sports & Outdoor", [node("empty-child", "Cycling")]),
];

describe("findCategory", () => {
  it("finds a root and reports no ancestors", () => {
    const found = findCategory(TREE, "fitness");
    expect(found?.node.id).toBe("fitness");
    expect(found?.ancestors).toEqual([]);
  });

  it("finds a level-3 node with its ancestors, root first", () => {
    const found = findCategory(TREE, "helmets");
    expect(found?.node.id).toBe("helmets");
    expect(found?.ancestors.map((a) => a.id)).toEqual(["so-1", "cycling"]);
  });

  it("returns null for an id the tree does not have", () => {
    expect(findCategory(TREE, "no-such-id")).toBeNull();
  });

  it("walks past a node that has no subcategories field at all", () => {
    // `fitness` has none. Reaching `so-1` afterwards proves the walk did not stop.
    expect(findCategory(TREE, "so-1")?.node.id).toBe("so-1");
  });

  it("does not confuse two nodes that share a name", () => {
    // Three roots on the tenant are called «Sports & Outdoor» and only one is
    // stocked. Matching on the label instead of the id would send a shopper to
    // an empty one.
    expect(findCategory(TREE, "so-2")?.node.id).toBe("so-2");
    expect(findCategory(TREE, "empty-child")?.ancestors.map((a) => a.id)).toEqual(["so-2"]);
  });
});
```

- [ ] **Step 2: Run the tests to watch them fail**

Run: `pnpm -F @viu/emporix-examples-next-server-first test`
Expected: FAIL — `Failed to resolve import "../app/lib/category-tree"`.

- [ ] **Step 3: Write the helper**

`examples/next-server-first/app/lib/category-tree.ts`:

```ts
import type { CategoryNode } from "@viu/emporix-sdk";
import { getEmporixClient } from "@viu/emporix-sdk-next";
import { siteContext } from "./site-context";

/**
 * Every category the tenant has, nested — in one cached call.
 *
 * `GET /category-trees` maps to the `emporix:categories` cache tag
 * (`packages/next/src/tags.ts`), so this is cached for an hour and the webhook
 * route invalidates it on `category.*`. Nothing extra is needed for freshness.
 *
 * It is the only source of hierarchy that works. Measured against `viu` on
 * 2026-08-04: `categories.subcategories(id)` reads assignments and was empty for
 * every category tried, `categories.childCategories(id)` answers 404 for a tree
 * root, and `categories.parents(id)` answers 404 for a root. The children come
 * inline here instead.
 *
 * On that tenant it returns 21 roots and 1'631 nodes — the same count as the flat
 * `categories.list()` — for 378 KiB and 282 ms on a cache miss.
 */
export async function categoryTree(): Promise<CategoryNode[]> {
  const client = getEmporixClient({ context: await siteContext() });
  return client.categories.tree(undefined);
}

export interface FoundCategory {
  node: CategoryNode;
  /** Root first, immediate parent last. Empty when the node is itself a root. */
  ancestors: CategoryNode[];
}

/**
 * Depth-first search by **id**, returning the node and the path to it.
 *
 * Pure — no call, no cache of its own. The ancestors come along because the walk
 * already knows them, and a breadcrumb is what makes level 4 of a six-level tree
 * navigable rather than disorienting.
 *
 * Matching on the id and not the label matters here: the `viu` tenant has three
 * roots named «Sports & Outdoor» and only one of them has products.
 */
export function findCategory(roots: CategoryNode[], id: string): FoundCategory | null {
  for (const root of roots) {
    const hit = walk(root, id, []);
    if (hit !== null) return hit;
  }
  return null;
}

function walk(node: CategoryNode, id: string, ancestors: CategoryNode[]): FoundCategory | null {
  if (node.id === id) return { node, ancestors };
  for (const child of node.subcategories ?? []) {
    const hit = walk(child, id, [...ancestors, node]);
    if (hit !== null) return hit;
  }
  return null;
}
```

- [ ] **Step 4: Run the tests to watch them pass**

Run: `pnpm -F @viu/emporix-examples-next-server-first test`
Expected: 11 passed — the 6 that existed plus these 5.

- [ ] **Step 5: Prove the duplicate-name test is not vacuous**

Temporarily change `walk`'s first line to match on the label instead of the id:

```ts
  if (node.name === id) return { node, ancestors };
```

Run the tests. Expected: the «does not confuse two nodes that share a name» test **fails**, and so do others. Then put `node.id === id` back and re-run to green. A test that passes either way is worth nothing — this is the check that it bites.

- [ ] **Step 6: Typecheck**

Run: `pnpm -F @viu/emporix-examples-next-server-first typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add examples/next-server-first/app/lib/category-tree.ts examples/next-server-first/tests/category-tree.test.ts
git commit -m "feat(examples): add a category-tree reader and walk"
```

---

### Task 3: the `/categories` route and the header link

**Files:**
- Create: `examples/next-server-first/app/categories/page.tsx`
- Modify: `examples/next-server-first/app/components/header.tsx` (the `<nav>`, after `<LanguageSwitcher />`)

**Interfaces:**
- Consumes: `categoryTree()` from Task 2; `catId`, `catLabel` from `@viu/emporix-examples-shared`.
- Produces: the route `/categories`.

- [ ] **Step 1: Write the page**

`examples/next-server-first/app/categories/page.tsx`:

```tsx
import { catId, catLabel } from "@viu/emporix-examples-shared";
import { categoryTree } from "../lib/category-tree";

/**
 * Every root category the tenant publishes.
 *
 * Roots, not all 1'631 categories: the tree is fully reachable from here by
 * drilling down, and rendering every node would be 378 KiB of links on one page.
 * The flat `categories.list()` is deliberately not used — it mixes every leaf in,
 * and on the `viu` tenant the overwhelming majority of leaves carry no products.
 *
 * No counts next to the names. The tenant has three roots called «Sports &
 * Outdoor» with exactly 30 leaves each, so a count would not tell them apart —
 * the one thing a reader would want it for.
 */
export default async function CategoriesPage(): Promise<React.JSX.Element> {
  const roots = await categoryTree();

  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <p className="eyebrow">Catalog</p>
      <h1 className="serif" style={{ marginBlock: "var(--s-2) var(--s-5)" }}>
        Categories
      </h1>

      {roots.length === 0 ? (
        <p className="muted">This tenant publishes no category trees.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {roots.map((c) => (
            <li key={catId(c)} className="cart__line">
              <a href={`/category/${encodeURIComponent(catId(c))}`} className="u-underline serif">
                {catLabel(c)}
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Add the header link**

In `examples/next-server-first/app/components/header.tsx`, inside the `<nav>`, immediately after `<LanguageSwitcher />`:

```tsx
          <a href="/categories" className="u-underline">
            Categories
          </a>
```

- [ ] **Step 3: Confirm the header still makes zero Emporix calls**

```bash
grep -n 'getEmporixClient\|categoryTree\|withEmporixSession' examples/next-server-first/app/components/header.tsx
```

Expected: no output. A plain `<a>` costs nothing, and that invariant is a README section with a measurement behind it — breaking it silently would make the README lie.

- [ ] **Step 4: Typecheck and build**

Run: `pnpm -F @viu/emporix-examples-next-server-first typecheck && pnpm -F @viu/emporix-examples-next-server-first build`
Expected: both clean, and the build output lists `/categories` among the routes.

- [ ] **Step 5: Commit**

```bash
git add examples/next-server-first/app/categories examples/next-server-first/app/components/header.tsx
git commit -m "feat(examples): add a categories route to the next demo"
```

---

### Task 4: breadcrumb and real child categories on `/category/[id]`

This is where the dead navigation gets replaced.

**Files:**
- Modify: `examples/next-server-first/app/category/[id]/page.tsx` (the whole data-loading block and the subcategory nav)

**Interfaces:**
- Consumes: `categoryTree()`, `findCategory()` from Task 2; `pricesFor` from `app/lib/prices.ts`; `ProductGrid`; `catId`, `catLabel`.

- [ ] **Step 1: Replace the imports and the data loading**

Replace the top of the file (imports through the `Promise.all`) with:

```tsx
import { notFound } from "next/navigation";
import { getEmporixClient } from "@viu/emporix-sdk-next";
import { catId, catLabel } from "@viu/emporix-examples-shared";

import { ProductGrid } from "../../components/product-grid";
import { pricesFor } from "../../lib/prices";
import { siteContext } from "../../lib/site-context";
import { categoryTree, findCategory } from "../../lib/category-tree";

const PAGE_SIZE = 24;

/**
 * Pagination through the URL, which is the whole point of this page.
 *
 * storefront-demo uses `useProductsInCategoryInfinite` and a «Load more» button
 * that appends. That needs client state to hold the accumulated pages, and there
 * is none here — so this **pages** instead of appending. A real behavioural
 * difference, not a cosmetic one, and the honest shape for a server-first mode.
 *
 * The upside: page 3 is a URL. It can be linked, bookmarked and crawled, which an
 * accumulating list cannot.
 */
export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  // `Number(undefined) || 1` is 1, `Number("abc") || 1` is 1, `Number("0") || 1`
  // is 1, and Math.max catches a negative. A page number arrives from the URL, so
  // the bound is drawn even though no framework is doing it.
  const page = Math.max(1, Number((await searchParams).page) || 1);

  const client = getEmporixClient({ context: await siteContext() });

  // Sequential, and NOT a Promise.all — measured 2026-08-04:
  // `productsIn("does-not-exist")` throws `EmporixNotFoundError`, so running both
  // in parallel lets that rejection win the race and the page 500s before
  // `notFound()` can run. The tree is cached for an hour, so awaiting it first
  // costs a cache read on all but the first request of the hour.
  const roots = await categoryTree();

  // The label and the hierarchy both come out of the tree, so `categories.get()`
  // is not called at all — one request fewer, and both are cached under the same
  // tag anyway.
  //
  // A category that exists but sits in no published tree therefore 404s here. On
  // the tenant this was measured against that cannot happen: `tree()` returned
  // 1'631 nodes and `categories.list()` counted 1'631 categories, so the tree is
  // the whole catalogue. A tenant with unpublished trees would need
  // `categories.get(id)` as a fallback.
  const found = findCategory(roots, id);
  if (found === null) notFound();
  const children = found.node.subcategories ?? [];

  const products = await client.categories.productsIn(
    id,
    { pageNumber: page, pageSize: PAGE_SIZE },
    undefined,
  );
  const priceOf = await pricesFor(client, undefined, products.items);
  const href = (n: number): string => `/category/${encodeURIComponent(id)}?page=${n}`;
```

- [ ] **Step 2: Replace the heading and the subcategory nav**

Replace the `<p className="eyebrow">Category</p>`, the `<h2>` and the whole `{subs.length > 0 ? ... : null}` block with:

```tsx
  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      {/* Ancestors come from the same walk that found the node, so the breadcrumb
          costs nothing. It is not parity with storefront-demo — it has none — but
          «Building & Construction» is six levels deep on this tenant, and without
          it level 4 gives a shopper no idea where they are. */}
      <p className="eyebrow">
        <a href="/categories" className="u-underline">
          Categories
        </a>
        {found.ancestors.map((a) => (
          <span key={catId(a)}>
            {" / "}
            <a href={`/category/${encodeURIComponent(catId(a))}`} className="u-underline">
              {catLabel(a)}
            </a>
          </span>
        ))}
      </p>
      <h2 className="serif" style={{ marginBlock: "var(--s-2) var(--s-5)" }}>
        {catLabel(found.node)}
      </h2>

      {/* Children from the TREE, not from `categories.subcategories()`. That call
          reads category-to-category assignments and answered empty for every
          category on this tenant, which is why this nav used to be dead — and why
          storefront-demo's still is. The hierarchy was always available; the old
          code read the wrong source. */}
      {children.length > 0 ? (
        <nav
          className="catnav"
          aria-label="Subcategories"
          style={{
            borderTop: "1px solid var(--line)",
            borderBottom: "1px solid var(--line)",
            marginBottom: "var(--s-6)",
          }}
        >
          {children.map((c) => (
            <a
              key={catId(c)}
              href={`/category/${encodeURIComponent(catId(c))}`}
              className="u-underline"
            >
              {catLabel(c)}
            </a>
          ))}
        </nav>
      ) : null}
```

- [ ] **Step 3: Point the product branch at `children`**

In the products block further down, the two references to `subs.length` become `children.length`:

```tsx
      {products.items.length === 0 ? (
        page > 1 ? (
          // Past the last page, not an empty category. Saying «no products» here
          // would be a lie about the category — and a page number in a URL is
          // exactly the kind of thing that goes stale in a bookmark.
          <p className="muted">
            Nothing on page {page}. <a href={href(1)} className="u-underline">Back to page 1</a>.
          </p>
        ) : children.length > 0 ? (
          // A pure parent category holds only subcategories, so the tiles above
          // are the answer — an «empty» notice would be wrong there.
          null
        ) : (
          <p className="muted">No products in this category.</p>
        )
      ) : (
```

- [ ] **Step 4: Confirm nothing still calls the dead methods**

```bash
grep -n 'subcategories(\|childCategories(\|categories.get(' examples/next-server-first/app/category/\[id\]/page.tsx
```

Expected: no output. `found.node.subcategories` is a field read, not a call — it will not match `subcategories(`.

- [ ] **Step 5: Typecheck and build**

Run: `pnpm -F @viu/emporix-examples-next-server-first typecheck && pnpm -F @viu/emporix-examples-next-server-first build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add examples/next-server-first/app/category
git commit -m "fix(examples): read category children from the tree, not assignments"
```

---

### Task 5: the home page stops hard-coding a category

**Files:**
- Modify: `examples/next-server-first/app/page.tsx`
- Modify: `examples/next-server-first/app/emporix.ts` (the `PRICED_CATEGORY` comment)

**Interfaces:**
- Consumes: `client.products.list({ pageSize }, auth?)`; `pricesFor`; `ProductGrid`; `Typeahead`.

- [ ] **Step 1: Replace the page**

`examples/next-server-first/app/page.tsx`:

```tsx
import { getEmporixClient } from "@viu/emporix-sdk-next";
import { Typeahead } from "./typeahead";
import { ProductGrid } from "./components/product-grid";
import { pricesFor } from "./lib/prices";
import { siteContext } from "./lib/site-context";

/**
 * Catalog reads use the MEMOIZED, TAGGED client — not withEmporixSession.
 * withEmporixSession in a Server Component gets a read-only cookie handle, so the
 * anonymous session it obtains cannot be persisted and the next render would log
 * in again. Catalog data needs no stable session, so the process-wide token is
 * both correct and cheaper.
 *
 * This used to list one hard-coded category so every tile was guaranteed a price.
 * `products.list` is what storefront-demo's home does, and it makes the demo
 * honest: a tenant's products are not all priced, so some tiles have no button.
 * That is the lesson, and hiding it behind a curated category taught nothing.
 */
export default async function Home(): Promise<React.JSX.Element> {
  const client = getEmporixClient({ context: await siteContext() });
  const page = await client.products.list({ pageSize: 12 }, undefined);
  const priceOf = await pricesFor(client, undefined, page.items);

  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <p className="eyebrow">Catalog</p>
      <h2 className="serif" style={{ marginBlock: "var(--s-2) var(--s-5)" }}>
        Products
      </h2>
      <p className="muted" style={{ maxWidth: "52ch" }}>
        Adding needs a price — Emporix requires a <code>priceId</code> on internal
        cart items, so a product without one shows no button.
      </p>
      <p>
        <a href="/categories" className="u-underline">
          Browse all categories →
        </a>
      </p>
      <Typeahead />
      <ProductGrid products={page.items} priceOf={priceOf} />
    </main>
  );
}
```

- [ ] **Step 2: Explain why the constant survives**

In `examples/next-server-first/app/emporix.ts`, replace the `PRICED_CATEGORY` comment with:

```ts
/**
 * Category known to contain priced products on the `viu` tenant.
 *
 * The home page no longer uses it — it lists `products.list()` like
 * storefront-demo does. The constant stays because the cart and checkout paths
 * need products that actually carry a `priceId`, and `/category/<this>` is the
 * shortest route to one for a manual walkthrough or an e2e run.
 */
export const PRICED_CATEGORY = "4a1a25bd-d828-476c-a481-925fcffe6f34";
```

- [ ] **Step 3: Confirm the constant has no importers left**

```bash
grep -rn 'PRICED_CATEGORY' examples/next-server-first/app
```

Expected: only the declaration in `app/emporix.ts`. If a page still imports it, that page was not part of this plan — read it before deciding.

- [ ] **Step 4: Typecheck, test, build**

Run: `pnpm -F @viu/emporix-examples-next-server-first typecheck && pnpm -F @viu/emporix-examples-next-server-first test && pnpm -F @viu/emporix-examples-next-server-first build`
Expected: clean, 11 tests, build clean.

- [ ] **Step 5: Commit**

```bash
git add examples/next-server-first/app/page.tsx examples/next-server-first/app/emporix.ts
git commit -m "feat(examples): list all products on the next demo home page"
```

---

### Task 6: live verification and the README

Nothing here is believed until it has been run against the tenant.

**Files:**
- Modify: `examples/next-server-first/README.md`

- [ ] **Step 1: Start the demo**

```bash
pnpm -F @viu/emporix-examples-next-server-first dev
```

`.env.local` needs `EMPORIX_TENANT` and `EMPORIX_STOREFRONT_CLIENT_ID`. Redis and a cookie secret are optional for this work — nothing here touches the session.

- [ ] **Step 2: Walk the four checks and record what you see**

| Check | Expectation |
|---|---|
| `/categories` | **21** links. Three of them read «Sports & Outdoor» — that is the tenant, not a bug. |
| click «Sports & Outdoor» `686435e9-6edc-4b5f-ba89-5f1a8caaf6ee` | 10 child tiles, no product grid (a pure parent). Breadcrumb reads `Categories`. |
| drill to `Cycling` then `Bike Helmets & Protection` | products with prices; breadcrumb reads `Categories / Sports & Outdoor / Cycling` |
| a leaf in «Building & Construction» | «No products in this category.» — 852 of its leaves are empty |
| `/category/does-not-exist` | **404**, not a 500 |
| `/` | 12 products, and at least one without an «Add to cart» button |

- [ ] **Step 3: Measure the walk instead of claiming it is cheap**

The spec promises a number for the in-memory walk. Add this to a throwaway file, run it, then delete the file:

```bash
node -e '
const t0 = process.hrtime.bigint();
// stand-in for the walk: 1631 nodes, depth 6
const mk = (d) => ({ id: String(Math.random()), subcategories: d === 0 ? [] : [mk(d-1), mk(d-1)] });
const roots = Array.from({ length: 21 }, () => mk(6));
const walk = (n, id) => n.id === id ? n : (n.subcategories ?? []).map(c => walk(c, id)).find(Boolean) ?? null;
for (const r of roots) walk(r, "miss");
console.log("walk over ~2600 nodes:", Number(process.hrtime.bigint() - t0) / 1e6, "ms");'
```

Then get the real figure from the dev server log: the `application-code` timing of `/categories` on a **cache miss** versus a **cache hit**. Both numbers go in the README. If the hit is not visibly cheaper, say so rather than claiming a cache that is not working.

- [ ] **Step 4: Write the README section**

Add before «What this demo deliberately does NOT have»:

```markdown
## Category browsing, and the navigation that was dead

`/categories` lists every root the tenant publishes; `/category/[id]` shows that
category's children, its breadcrumb and its products. All of it comes from **one**
call — `categories.tree()` — which returns every category nested, is tagged
`emporix:categories` and cached for an hour.

That the nav used to render nothing was not a tenant limitation, which is what an
earlier version of this file claimed. Measured 2026-08-04:

| call | endpoint | on `viu` |
|---|---|---|
| `categories.subcategories(id)` | `/categories/{id}/assignments`, kept where `ref.type === "CATEGORY"` | empty for every category tried |
| `categories.childCategories(id)` | `/categories/{id}/subcategories` | **404** on a tree root |
| `categories.parents(id)` | `/categories/{id}/parents` | 404 on a root, 2–4 ancestors on a leaf |
| `categories.tree()` | `/category-trees` | the whole hierarchy, children inline |

The old code called the first one. storefront-demo still does, so its subcategory
nav is dead for the same reason.

And the assignments endpoint is not empty — that was the misleading part.
`productsIn(id)` reads **the same URL** and keeps `ref.type === "PRODUCT"`, which
is why products work. This tenant simply expresses category-to-category
relationships in trees and category-to-product relationships in assignments, so
one of the two filters always comes back with nothing.

### What the tenant actually has

| | |
|---|---|
| `categories.list()` | 1'631 categories |
| `categories.tree()` | 21 roots, 1'631 nodes — the same number, so the tree is the whole catalogue |
| payload | 378 KiB, 282 ms on a cache miss |
| roots without children | 16, and they carry products directly |
| roots with children | 5 — «Sports & Outdoor» ×3 (30 leaves each), «Computers & Peripherals» (520), «Building & Construction» (852) |

**Three roots are called «Sports & Outdoor» and only one has products** (`686435e9`).
They are all shown anyway: hiding tenant data by a criterion Emporix does not have
would only hit the stocked one by luck. «Computers & Peripherals» and
«Building & Construction» hold 1'372 leaves between them and none of the sampled
ones carry a product — that is the tenant's catalogue, not a defect here.

### Verified 2026-08-04

Copy the six rows from Step 2 of the plan here with the result you actually got in
the browser, not the expectation — including any row that came out differently, and
the two `application-code` timings from Step 3 (cache miss and cache hit). A row
whose outcome was not observed does not belong in this table.

One thing this shape gives up: a category that exists but sits in no published tree
404s, because the label and hierarchy both come from the tree and `categories.get()`
is never called. It cannot happen on this tenant — the node count matches the flat
list exactly — but a tenant with unpublished trees would need `categories.get(id)`
as a fallback.
```

- [ ] **Step 5: Correct the two places that now say something false**

```bash
grep -n 'priced category\|PRICED_CATEGORY\|assignments' examples/next-server-first/README.md
```

Every hit that describes the home page as showing one curated category, or the
subcategory nav as permanently dead, is now wrong. Fix each — this plan's whole
premise is that stale documentation is a defect.

- [ ] **Step 6: Full sweep**

```bash
pnpm -r build && pnpm -r test && pnpm typecheck && pnpm lint
```

Expected: builds clean, 1'455 package tests plus 11 in the example, 11 typecheck projects, lint clean.

- [ ] **Step 7: e2e, because the SDK changed**

```bash
pnpm e2e
```

Expected: 6 passed, 0 skipped. Free port 5173 first — any other Vite dev server there gets tested instead of `vite-spa`, and the failure reads like a real regression (`locator('ul li')` expected 12, received 0).

- [ ] **Step 8: Commit and open the PR**

```bash
git add examples/next-server-first/README.md
git commit -m "docs(examples): record the category browsing verification"
git push origin feat/next-category-tree
```

Then open a PR against `main` describing: the two corrections (the dead-nav conclusion and the SDK return type), the measured tenant numbers, and the four non-goals from the spec. Do **not** merge it.

---

## Self-review

**Spec coverage.** Every section maps to a task: the SDK type fix and its doc comment → Task 1; the helper, `findCategory`, and its five tests → Task 2; `/categories` and the header link → Task 3; breadcrumb, tree children and `notFound()` → Task 4; the home page and `PRICED_CATEGORY` → Task 5; the error-handling table, the README and the live checks → Task 6. The spec's «no counts» decision is carried in Task 3's page comment; the four non-goals need no code and are recorded in the PR text in Task 6 Step 8.

**Type consistency.** `categoryTree()`, `findCategory()`, `FoundCategory`, `node`, `ancestors` are spelled the same in Tasks 2, 3 and 4. `CategoryNode` is used everywhere, never `CategoryTree` — the latter is not exported from the SDK root, the former is and is its alias.

**One gap found and closed while reviewing:** Task 4 removes the `categories.get()` call, which the spec's error-handling section implies but does not say outright. The consequence — a category outside every published tree now 404s — is written into the code comment in Task 4 Step 1 and into the README in Task 6 Step 4, rather than left for someone to discover.

**One defect in an earlier draft of this plan, found by measuring instead of assuming.** Task 4 originally fetched the tree and the products with `Promise.all`. `productsIn("does-not-exist")` **throws** `EmporixNotFoundError` — measured — so the rejection would win the race and an unknown category id would 500 before `notFound()` ran, which is exactly the behaviour the spec forbids. The calls are sequential now, and the reason is in the code comment so nobody «optimises» it back.

**Observed while measuring, deliberately not fixed here.** `productsIn(id, { pageSize: 24 })` fetches 24 **assignments** and then filters them down to `ref.type === "PRODUCT"`, so a category holding a mix of product and category assignments returns fewer than 24 products for a full page — and `hasNextPage` describes the assignment page, not the product page. It cannot bite on this tenant, where category assignments are empty everywhere. It is a real SDK defect, it is outside this spec, and it belongs in its own issue rather than being smuggled into a demo PR.
