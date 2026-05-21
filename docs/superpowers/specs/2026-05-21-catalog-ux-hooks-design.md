# Catalog-UX Hooks — Design

## Context

`@viu/emporix-sdk-react` wraps the most common catalog reads — `useProduct(id)`, `useProducts(params)`, `useProductsInfinite`, `useCategory(id)`, `useCategories(params)`, `useCategoriesInfinite`, `useCategoryTree` — but three storefront-essential reads are uncovered:

| Use case | SDK method | Hook today |
|---|---|---|
| Product detail page via URL slug `/products/T-SHIRT-XL` | `products.getByCode(code)` | none |
| Search box in the header | `products.search(query, params)` | none |
| Category landing page with paginated products | `categories.productsIn(categoryId, params)` | none |

This change adds the three hooks (plus an infinite-scroll variant of the category-products list) so a standard storefront can be built end-to-end with hooks-only — no `client.*` plumbing for catalog reads.

## Goals

- `useProductByCode(code, opts?)` — resolves a single product by its code (slug-based routing).
- `useProductSearch(query, params?, opts?)` — full-text search with pagination.
- `useProductsInCategory(categoryId, params?, opts?)` — paginated product list for a category page.
- `useProductsInCategoryInfinite(categoryId, params?, opts?)` — infinite-scroll variant of the same.
- All four auto-detect auth via the shared `useReadAuth` helper (customer if token in storage, otherwise anonymous).
- All four return the canonical shapes (`UseQueryResult<Product>` / `UseQueryResult<PaginatedItems<Product>>` / `UseInfiniteQueryResult<...>`), consistent with the existing hooks.
- Disabled-by-default semantics: hooks with an optional `code` / `categoryId` / `query` arg gate via `enabled` when the arg is empty/undefined (matches `useCart(cartId?)` behavior).

## Non-Goals

- New SDK methods. Everything wraps existing `client.products.*` / `client.categories.*`.
- Category-tree variants (already covered by `useCategoryTree`).
- Search-by-attributes / faceted search. Emporix's `products.search` takes a `q` string today; the SDK doesn't expose filter facets. If they ship later, the hook signature can extend without breaking.
- Caching invalidation strategies — these are pure reads; consumers can use React-Query's invalidation API directly when needed.
- Product-detail-page convenience hooks like "useProductWithMedia" — `useProduct` + `useProductMedia` already compose for that.

## Architecture

### File layout

```
packages/react/src/hooks/
├── use-products.ts          ← extend with useProductByCode + useProductSearch
├── use-categories.ts        ← extend with useProductsInCategory + useProductsInCategoryInfinite
├── ...                      ← unchanged
```

Two file modifications, no new files. The hooks naturally belong in the existing domain files.

### `useProductByCode(code, opts?)`

```typescript
export function useProductByCode(
  code: string | undefined,
  options: QueryOpts = {},
): UseQueryResult<Product>
```

- `enabled: code !== undefined && code !== ""` — idle when no code provided (useful for routes like `/products/[slug]` where the param might be missing during initial render).
- Query key: `["emporix", "product-by-code", code, { tenant, authKind }]`.
- Calls `client.products.getByCode(code, ctx)`.
- Throws if the code doesn't resolve to a product (matches the SDK behavior: `throw new Error(`No product with code "${code}"`)` from the SDK is surfaced via `useQuery.error`).

### `useProductSearch(query, params?, opts?)`

```typescript
export function useProductSearch(
  query: string | undefined,
  params: { pageNumber?: number; pageSize?: number } = {},
  options: QueryOpts = {},
): UseQueryResult<PaginatedItems<Product>>
```

- `enabled: query !== undefined && query.trim() !== ""` — idle on empty input (debouncing is consumer-side).
- Query key: `["emporix", "product-search", query, params, { tenant, authKind }]`.
- Calls `client.products.search(query, params, ctx)`.

### `useProductsInCategory(categoryId, params?, opts?)`

```typescript
export function useProductsInCategory(
  categoryId: string | undefined,
  params: { pageNumber?: number; pageSize?: number } = {},
  options: QueryOpts = {},
): UseQueryResult<PaginatedItems<Product>>
```

- `enabled: categoryId !== undefined && categoryId !== ""`.
- Query key: `["emporix", "products-in-category", categoryId, params, { tenant, authKind }]`.
- Calls `client.categories.productsIn(categoryId, params, ctx)`.

### `useProductsInCategoryInfinite(categoryId, params?, opts?)`

```typescript
export function useProductsInCategoryInfinite(
  categoryId: string | undefined,
  params: { pageSize?: number } = {},
  options: QueryOpts = {},
): UseInfiniteQueryResult<{ pages: PaginatedItems<Product>[]; pageParams: number[] }>
```

- Same `enabled` gate as the single-page variant.
- Query key: `["emporix", "products-in-category-infinite", categoryId, params, { tenant, authKind }]`.
- Uses `initialPageParam: 1` + `getNextPageParam: (last) => last.hasNextPage ? last.pageNumber + 1 : undefined` — same pattern as `useProductsInfinite` / `useCategoriesInfinite`.

### Public API additions

In `packages/react/src/hooks/index.ts`:

```typescript
export {
  useProduct,
  useProducts,
  useProductsInfinite,
  useProductByCode,           // NEW
  useProductSearch,           // NEW
} from "./use-products";
export {
  useCategory,
  useCategories,
  useCategoriesInfinite,
  useCategoryTree,
  useProductsInCategory,            // NEW
  useProductsInCategoryInfinite,    // NEW
} from "./use-categories";
```

In `packages/react/src/index.ts`: same names added to the root re-export list.

## Data Flow

### Product detail page via slug

```
[user navigates to /products/T-SHIRT-XL]
  ↓ Router param: code = "T-SHIRT-XL"
useProductByCode("T-SHIRT-XL")
  ↓ enabled (code is truthy)
  ↓ GET /product/{tenant}/products?q=code:T-SHIRT-XL
  ↓ SDK picks rows[0]
[useProduct returns the single Product]
```

### Search box

```
[user types "shirt" in header]
  ↓ consumer debounces (e.g. 300ms)
useProductSearch("shirt", { pageSize: 10 })
  ↓ enabled (query is truthy + non-empty)
  ↓ GET /product/{tenant}/products?q=shirt&pageNumber=1&pageSize=10
[returns PaginatedItems<Product>]
```

### Category page with infinite scroll

```
[user opens /categories/electronics]
useProductsInCategoryInfinite("electronics", { pageSize: 24 })
  ↓ page 1: GET /category/{tenant}/categories/electronics/products?pageNumber=1&pageSize=24
[user scrolls]
  ↓ fetchNextPage() → page 2 (hasNextPage from page 1 was true)
  ↓ GET ...?pageNumber=2&pageSize=24
[continues until hasNextPage=false]
```

## Testing

Unit tests in `packages/react/tests/`:

- `tests/use-products.test.tsx` — extend with 2 tests:
  - `useProductByCode` is disabled when code is undefined / empty.
  - `useProductByCode("X")` fetches and returns the matching product.
  - `useProductSearch` is disabled on empty query.
  - `useProductSearch("term", { pageSize: 10 })` PaginatedItems shape + query param forwarding.

- `tests/use-categories.test.tsx` — extend with 4 tests:
  - `useProductsInCategory` is disabled without categoryId.
  - `useProductsInCategory("c1", { pageSize: 12 })` GETs the products endpoint with the path id and pageSize.
  - `useProductsInCategoryInfinite("c1")` terminates on `hasNextPage=false` without trailing empty fetch.
  - `useProductsInCategoryInfinite("c1", { pageSize: 2 })` flattens 3 items across 2 pages.

## Risk / Compatibility

| Concern | Mitigation |
|---|---|
| Search hook fires per-keystroke if consumer forgets debounce | Documented in `docs/react.md` with explicit debouncing example. |
| Category-id typo silently returns empty list | Emporix's API contract — out of scope; surface error via `useQuery.error` if it 4xxs. |
| Query-key cardinality grows fast with search terms | Standard React-Query behavior — gcTime + staleTime tunable per-hook by consumer via the standard useQuery options pattern. Not adding extra knobs in v1. |

**Changeset:** minor for `@viu/emporix-sdk-react`. SDK untouched.

## File Structure

| File | Change |
|---|---|
| `packages/react/src/hooks/use-products.ts` | Add `useProductByCode`, `useProductSearch` |
| `packages/react/src/hooks/use-categories.ts` | Add `useProductsInCategory`, `useProductsInCategoryInfinite` |
| `packages/react/src/hooks/index.ts` | Re-export 4 new symbols |
| `packages/react/src/index.ts` | Re-export 4 new symbols at root |
| `packages/react/tests/use-products.test.tsx` | Add 4 tests (2 for each hook) |
| `packages/react/tests/use-categories.test.tsx` | Add 4 tests |
| `.changeset/catalog-ux-hooks.md` | Minor changeset |
| `docs/react.md` | Document the 4 new hooks under existing Product/Category sections |

## Out-of-scope follow-ups

- Faceted search hook (`useProductFacets`) once the SDK exposes facets.
- `useProductsByIds(ids[])` for cart-page product hydration — currently `client.products.searchByIds` is internal-only (used by `useMySegmentProducts`). Promote when a consumer asks.
- `useCategoryByCode(code)` — Emporix doesn't expose code-based category lookup today, so no SDK method to wrap.
- Storefront Example page demonstrating slug-routing + category-page + search — would round out the reference but is a separate UX-Plan iteration.
