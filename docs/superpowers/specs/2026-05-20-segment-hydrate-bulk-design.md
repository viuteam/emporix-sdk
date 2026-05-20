# Segment Hydrate via Bulk Search + Paginated Hooks — Design

**Date:** 2026-05-20
**Status:** Approved (design)

## Goal

Make `SegmentService.listMyProducts` / `listMyCategories` resolve a customer's
segment products and categories in **one** Emporix call instead of N+1, and
expose paginated React hooks (single-page + infinite-scroll variants) that
storefronts can use directly to build "load more" UIs.

## Decisions (locked with the user)

| # | Decision |
|---|----------|
| 1 | Add `searchByIds(ids, options?, auth?)` to `ProductService` **and** `CategoryService` — POST `/search` with `q="id:(…)"`, configurable `chunkSize` (default 100), empty-ids short-circuit. |
| 2 | Refactor `SegmentService.listMyProducts` / `listMyCategories` to use `searchByIds`. The return shape changes from `Product[]` to a paginated page object — **breaking**, `minor` changeset with note. |
| 3 | New generic type **`PaginatedItems<T>`** in `core/context.ts` (next to the existing `Page<T>` — distinct semantics: page-based + `hasNextPage`, not offset/limit/total). |
| 4 | React: four new hooks — `useMySegmentProducts` / `useMySegmentProductsInfinite` and `useMySegmentCategories` / `useMySegmentCategoriesInfinite`, mirroring the existing `useProducts` + `useProductsInfinite` pattern. |

## Validated Emporix API facts

- **Canonical bulk-by-ids read** (Product & Category services):
  `POST /<service>/{tenant}/<resource>/search` with body
  `{ "q": "id:(id1,id2,...)" }` and query `pageSize=<chunk>`. Documented in
  the Emporix query DSL reference (`q-param` page); the `q=id:(...)` IN-form
  is the canonical multi-ID lookup.
- **No documented limit** on result-set size; the practical caps are URL
  length (~10 KB on GET — POST avoids this) and the 10 MB response body
  ceiling. We chunk at **100** by default; caller can override.
- **Order is not guaranteed** by the platform for `q=id:(…)`. Consumers
  that need input-order must re-index by `id`.
- **`/segments/items`** (the source endpoint we paginate on) accepts the
  standard `pageNumber`/`pageSize` query params per Emporix list-endpoint
  convention. We extend `SegmentService.listItems` to forward them.

## Architecture

### A. Generic page type

```ts
// packages/sdk/src/core/context.ts (add next to the existing Page<T>)

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

Re-exported from `packages/sdk/src/index.ts`.

### B. `searchByIds` on Product & Category services

```ts
async searchByIds(
  ids: string[],
  options: { chunkSize?: number } = {},
  auth: AuthContext = ANON,
): Promise<Product[]>   // (or Category[])
```

- `ids: []` → return `[]` with **zero** HTTP calls.
- Chunk `ids` by `options.chunkSize ?? 100`. Per chunk:
  `POST /product/{tenant}/products/search?pageSize=<chunk.length>` with body
  `{ q: "id:(" + chunk.join(",") + ")" }` (same shape on category service).
- `Promise.all` over chunks; concatenate results.
- Order **not** preserved across chunks; documented in JSDoc.
- Default auth `anonymous` (consistent with the existing list/get/search).

### C. `SegmentService` — paginated source + page-shaped hydrate

Extend `listItems` (additive — non-breaking on call sites that omit the
new params):

```ts
listItems(
  query?: {
    q?: string;
    siteCode?: string;
    legalEntityId?: string;
    onlyActive?: boolean;
    pageNumber?: number;   // NEW
    pageSize?: number;     // NEW
  },
  auth?: AuthContext,
): Promise<SegmentItem[]>
```

Refactor the hydrate helpers — **breaking** return-type change:

```ts
listMyProducts(
  query?: Parameters<SegmentService["listItems"]>[0],
  auth?: AuthContext,
): Promise<PaginatedItems<Product>>

listMyCategories(
  query?: Parameters<SegmentService["listItems"]>[0],
  auth?: AuthContext,
): Promise<PaginatedItems<Category>>
```

Implementation:

1. Resolve effective `pageNumber = query?.pageNumber ?? 1` and
   `pageSize = query?.pageSize ?? 20`.
2. Call `listItems({ …query, pageNumber, pageSize }, auth)`. This is the
   **source** page — its length determines `hasNextPage` (a full page
   means there may be more).
3. Filter the page by `r.type === "PRODUCT"` (or `"CATEGORY"`) and pull
   `r.item?.id`. Empty → `items: []`, `hasNextPage` still computed from
   the source page length.
4. `searchByIds(ids)` on the relevant service (one HTTP call when the
   page's id count ≤ chunkSize). Return:
   ```ts
   { items: hydrated, pageNumber, pageSize, hasNextPage: pageItems.length === pageSize }
   ```

Note: `hasNextPage` is derived from the **source segment-items** page
being full, not the hydrated items array. A page that has 20 segment
items but only 5 are `PRODUCT` still has `hasNextPage: true` because the
next source page may yield more PRODUCT items.

`listMyProductIds` / `listMyCategoryIds` (the ID-only helpers) keep
their current flat-array `Promise<string[]>` shape — they're cheap and
useful for callers that don't want pagination.

### D. React hooks (single-page + infinite per type)

Mirrors the existing `useProducts` / `useProductsInfinite` pattern:

```ts
// single page
useMySegmentProducts(query?: {
  q?; siteCode?; legalEntityId?; onlyActive?;
  pageNumber?: number;
  pageSize?: number;
}): UseQueryResult<PaginatedItems<Product>>

// infinite scroll
useMySegmentProductsInfinite(query?: {
  q?; siteCode?; legalEntityId?; onlyActive?;
  pageSize?: number;     // pageNumber driven by the cursor
}): UseInfiniteQueryResult<PaginatedItems<Product>, unknown>
```

And the same pair for categories.

- `enabled: token !== null` (no fetch for guests).
- `pageSize` hook default: **20**.
- queryKey prefix `["emporix", "segment", "myProducts" | "myProductsInfinite" | "myCategories" | "myCategoriesInfinite", { tenant, query }]`. Sharing the `["emporix","segment"]` prefix means one invalidation on login/logout clears all of them.
- Infinite hooks: `initialPageParam: 1`,
  `getNextPageParam: (last) => last.hasNextPage ? last.pageNumber + 1 : undefined`.
  The hook's `queryFn` receives `pageParam` and calls
  `client.segments.listMyProducts({ …query, pageNumber: pageParam, pageSize })`.

Storefront usage:

```tsx
const q = useMySegmentProductsInfinite({ pageSize: 20 });
const products = q.data?.pages.flatMap((p) => p.items) ?? [];

return (
  <>
    {products.map(...)}
    {q.hasNextPage && <button onClick={() => q.fetchNextPage()}>Load more</button>}
  </>
);
```

## Error handling

- Reuse the existing `HttpClient` typed-error mapping. A 5xx on the bulk
  `/search` call propagates as `EmporixServerError`; a 4xx as the
  matching typed error. No SDK-side retry beyond `HttpClient` defaults.
- Empty-ids short-circuit in `searchByIds` returns `[]` without an HTTP
  call — and consequently `listMyProducts` returns
  `{ items: [], pageNumber, pageSize, hasNextPage }` correctly even when
  the source page has only CATEGORY rows (or vice versa).
- **`hasNextPage` semantic risk:** a page that returns exactly `pageSize`
  segment items where the very last segment-item is the final one creates
  a false-positive `hasNextPage: true`. The next-page fetch returns `0`
  items with `hasNextPage: false`; the infinite scroll cleanly terminates.
  Documented in JSDoc and `docs/segments.md`.

## Testing

- **SDK (msw):**
  - `searchByIds` happy path (one chunk).
  - `searchByIds` with `chunkSize: 2` and 5 ids → 3 POST calls; results
    concatenated; verify each chunk's `q` body matches the expected slice.
  - `searchByIds([])` → no HTTP call, returns `[]`.
  - `searchByIds` propagates a 500.
  - `listItems` forwards `pageNumber`/`pageSize` query params.
  - `listMyProducts` / `listMyCategories` return `PaginatedItems<…>` with
    `hasNextPage` computed from the source page being full (true case),
    not-full (false case), empty source (false case),
    empty-after-filter (still uses source length).
- **React (jsdom):**
  - `useMySegmentProducts` returns the page object; disabled when no
    customer token.
  - `useMySegmentProductsInfinite` initially fetches page 1; calling
    `fetchNextPage()` fetches page 2 with the correct `pageNumber`;
    `hasNextPage` flips to false when the source page is short.
  - Same pair for categories.
- Coverage ≥80% on `packages/*` maintained.

## Release / docs

- `@viu/emporix-sdk` **minor** — new `PaginatedItems<T>`, new
  `searchByIds` methods, extended `listItems`, and the **BREAKING**
  return-type change on `listMyProducts` / `listMyCategories`. Explicit
  BREAKING note in the changeset.
- `@viu/emporix-sdk-react` **minor** — four new hooks
  (`useMySegmentProducts`, `useMySegmentProductsInfinite`,
  `useMySegmentCategories`, `useMySegmentCategoriesInfinite`).
- `docs/segments.md` gains a pagination section with the
  `useMySegmentProductsInfinite` snippet above and a note on the
  `hasNextPage` semantics.

## Plan decomposition

Cohesive enough for **one spec**; one phased plan, branch
`feat/segment-hydrate-bulk` from `main`:

1. `PaginatedItems<T>` in `core/context.ts` + index re-export.
2. `ProductService.searchByIds` + tests.
3. `CategoryService.searchByIds` + tests.
4. `SegmentService.listItems` pagination + `listMyProducts` / `listMyCategories`
   refactor to bulk + page object; rewrite/update existing tests
   (the previous N+1 assertions + the flat-array return shape).
5. `useMySegmentProducts` + `useMySegmentProductsInfinite` + tests.
6. `useMySegmentCategories` + `useMySegmentCategoriesInfinite` + tests.
7. `docs/segments.md` pagination section + changeset (BREAKING note) +
   green gate + finish.

## Out of scope (YAGNI)

- A `Promise.allSettled` partial-success variant of `searchByIds`
  (current "first failure rejects" matches the existing patterns).
- Bidirectional pagination / previous-page navigation — Emporix's
  segment-items pagination is forward-only in practice; the infinite
  hooks expose `fetchNextPage`, not `fetchPreviousPage`.
- Re-indexing `searchByIds` results into the input ID order — caller's
  responsibility when order matters.
- A combined `useMySegmentItems`-with-hydrate flag — explicitly rejected
  earlier (Decision 4: dedicated hooks).
