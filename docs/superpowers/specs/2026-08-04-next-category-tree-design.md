# Category browsing in `next-server-first` — design

**Goal:** make every category of a tenant reachable in `examples/next-server-first`,
with its products, from one cached call — and fix the two things that made the
existing subcategory navigation dead.

**Status:** approved 2026-08-04. Implementation plan follows.

---

## What is there today

`examples/next-server-first/app/category/[id]/page.tsx` is already at parity with
storefront-demo's `Category.tsx`: category label, subcategory nav, paginated
products, resolved prices. The one deliberate difference is pagination instead of
«Load more», because there is no client state to accumulate pages into.

**What is missing is the way in.** The home page renders products from a single
hard-coded category (`PRICED_CATEGORY`) and there is no category navigation
anywhere, so `/category/[id]` is only reachable by typing a URL. storefront-demo
mounts `CategoryNav` (which calls `useCategoryTree()`) in `Home.tsx`.

## The tenant, measured 2026-08-04

| | |
|---|---|
| `categories.list()` | **1'631** categories |
| `categories.tree()` | **21** roots, **1'631** nodes — the same number |
| payload | **378 KiB**, 282 ms, one call |
| roots without children | 16 — they carry products directly |
| roots with children | 5 — «Sports & Outdoor» ×3 (30 leaves each), «Computers & Peripherals» (520), «Building & Construction» (852) |
| deepest tree | «Building & Construction», 934 nodes, 6 levels |

**`categories.tree()` returns every category the tenant has, nested.** The node
count matches the flat list exactly, so «all categories» is one call away — it just
arrives as a hierarchy instead of a list.

Product coverage is uneven, and the design has to survive that:

| root | sampled leaves with products |
|---|---|
| the 16 childless roots | 15 of 16 (only «Migros» is empty) |
| «Sports & Outdoor» `686435e9` | **8 of 8** — three clean levels, e.g. `Sports & Outdoor > Cycling > Bike Helmets & Protection` |
| «Sports & Outdoor» `7886b163`, `630559c0` | 0 of 8 each |
| «Computers & Peripherals» | 0 of 8, across 520 leaves |
| «Building & Construction» | 0 of 8, across 852 leaves |

So 1'372 of the 1'631 categories sit in trees whose sampled leaves are all empty.
That is the tenant's data, not a defect to design around — but it decides what the
demo surfaces first.

## Why the tree is the only source

Three methods look like they should give a hierarchy. Measured against `viu`:

| call | endpoint | result |
|---|---|---|
| `categories.subcategories(id)` | `GET /categories/{id}/assignments` | **empty for every category tried** |
| `categories.childCategories(id)` | `GET /categories/{id}/subcategories` | **404** on tree roots |
| `categories.parents(id)` | `GET /categories/{id}/parents` | 404 on roots, 2–4 ancestors on leaves |
| `categories.tree()` | `GET /category-trees` | the whole hierarchy, `subcategories` inline |

The method names are inverted relative to their endpoints — `subcategories()` hits
`/assignments`, `childCategories()` hits `/subcategories` — which is worth knowing
but does not help: neither returns anything usable here. `tree()` is the only way
in, and the children arrive inline rather than through a second call.

Both demos call `subcategories()`, which is why both subcategory navs are dead.

## Two corrections this design carries

**1. A wrong conclusion of mine, in the code.** The comment in
`app/category/[id]/page.tsx` says the nav «Never renders on the `viu` tenant …
Kept because other tenants do use assignments». The diagnosis was right and the
conclusion was wrong: the hierarchy is available, the nav reads the wrong source.
It gets replaced by tree children, and the comment goes with it.

**2. A wrong return type in the SDK.** `categories.tree()` is declared
`Promise<Category[]>`, but `/category-trees` returns `CategoryTree[]`:

- `Category` has `parentId`, no `subcategories`
- `CategoryTree` has `subcategories?: Array<CategoryTree>`, no `parentId`
- the measured payload has `subcategories` and no `parentId`

So the declared type is factually wrong, and reading `node.subcategories` off the
result needs a cast that should not exist. Fixed to `Promise<CategoryTree[]>`
(`CategoryNode` is already an alias of it, and `getTree()` returns it). The doc
comment on `tree()` also points readers to `{@link subcategories}` for drilling
down — the exact wrong turn — and is corrected to name the inline field.

Type-only change, no runtime difference. It can surface a compile error in consumer
code that read `parentId` off a tree node, which was always `undefined` — that is
the point of fixing it. Ships as a **patch** for `@viu/emporix-sdk` with that noted.

## Architecture

One helper, one cached call, no second network round trip:

```ts
// examples/next-server-first/app/lib/category-tree.ts
export async function categoryTree(): Promise<CategoryTree[]>;

export interface FoundCategory {
  node: CategoryTree;
  /** Root first, immediate parent last. Empty for a root. */
  ancestors: CategoryTree[];
}
export function findCategory(roots: CategoryTree[], id: string): FoundCategory | null;
```

`categoryTree()` wraps `getEmporixClient({ context: await siteContext() })
.categories.tree(undefined)`. The URL maps to the `emporix:categories` tag
(`packages/next/src/tags.ts`, unit-tested for this shape), so it is cached for an
hour and the webhook route already invalidates it on `category.*` events. Nothing
new is needed for cache correctness.

`findCategory` is a pure depth-first walk — no call, no cache of its own. It returns
the ancestors alongside the node because the walk knows them anyway, and a
breadcrumb at level 4 of a 6-level tree is the difference between navigable and
lost.

**The cost, stated rather than hidden:** 378 KiB sits in Next's data cache and is
parsed and walked on every render that needs a category. At 1'631 nodes that is
single-digit milliseconds. It will be measured, not asserted, and the number goes
in the README.

There is no cheaper shape available. `getTree(rootId)` would fetch one subtree, but
finding which root an arbitrary category belongs to requires the full tree first.

## Routes

| Route | change | shows |
|---|---|---|
| `/categories` | **new** | all 21 roots, each linking to `/category/[id]` — no counts, see below |
| `/category/[id]` | extended | breadcrumb from `ancestors`, child categories from `node.subcategories`, then products and pagination as today |
| `/` | changed | `products.list({ pageSize: 12 })` instead of `productsIn(PRICED_CATEGORY)`, plus a link to `/categories` |
| header | one link | «Categories» — a plain `<a>`, no Emporix call |

**The header stays at zero Emporix calls.** That invariant has its own README
section with a measurement behind it («three page loads → the record is
byte-identical»), and a category nav in the shell would break it for a cached call
that nothing on most pages needs. `/categories` carries the cost on the one page
that is about categories.

`/categories` shows all 21 roots including the three identically named
«Sports & Outdoor». Hiding them would mean discarding tenant data by a criterion
Emporix does not have — and would only hit the stocked one by luck. The README
records which two are empty.

**No counts next to the names.** A leaf or descendant count was considered and
dropped: all three «Sports & Outdoor» roots have exactly 30 leaves, so the number
does not tell them apart — the one thing a reader would want it for. It would only
add signal on «Computers & Peripherals» (520) and «Building & Construction» (852),
which are the two trees with no products anyway.

## Error handling

- **Unknown category id** → `notFound()`, as `/product/[id]` already does. With the
  tree in hand this is a `findCategory(...) === null` check rather than a caught
  `EmporixNotFoundError`, so it costs no failed request.
- **A category with children and no products** → the child tiles are the answer; no
  «no products» notice. That branch exists today and stays.
- **A category with neither** → «No products in this category.» Reachable on this
  tenant: 1'372 leaves qualify.
- **`tree()` fails** → the page throws and Next renders the error boundary. No
  fallback: a category browser with no categories has nothing to show, and a silent
  empty list would look like a tenant with no catalogue.

## Testing

Unit tests belong to `findCategory` and nothing else, in
`examples/next-server-first/tests/category-tree.test.ts` — the existing vitest
setup, no new scaffolding. It is a recursive function over untrusted shapes, which
is exactly the kind of logic that earns a test:

- finds a root (ancestors empty)
- finds a level-3 node with both ancestors in order
- returns `null` for an unknown id
- survives a node without `subcategories`
- does not confuse two nodes with the same **name** but different ids — the
  «Sports & Outdoor» case, built as a fixture

Everything else is verified by running it against `viu`, with a dated table in the
README: root count, one drill-down to a stocked leaf, one to an empty one, the
breadcrumb, an unknown id giving 404, and the measured render cost of the walk.

## Non-goals

Each was decided, not overlooked:

- **No flat list of all 1'631 categories.** Reachability comes from the tree. A
  paginated dump would be mostly dead ends — the reason storefront-demo's own
  `CategoryNav` comment gives for avoiding `categories.list()`.
- **No dedupe of the three «Sports & Outdoor» roots.** See above.
- **No «only categories with products» filter.** It needs a `productsIn` call per
  category — 1'631 requests — or a hard-coded allow-list, which is the thing this
  work removes.
- **`PRICED_CATEGORY` is not deleted**, only removed from `app/page.tsx`. The e2e
  cart path needs products that carry a price; the constant stays in
  `app/emporix.ts` with a comment saying exactly that.
- **storefront-demo is not fixed here.** Its subcategory nav is dead for the same
  reason and could use the same walk, but that is a second demo, a second PR, and a
  React-Query shape rather than a server one.

## Branch note

This branches off `main` at `cef1872`, which does **not** include the
`sessionCookieJar` → `emporixSessionHandle` rename (open in #204). Nothing in this
work touches the session — it is all `getEmporixClient` — so the two do not
collide. If #204 lands first, no change here needs rewriting.
