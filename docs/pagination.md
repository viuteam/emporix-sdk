# Pagination

The SDK uses a single pagination contract across all list/search endpoints and hooks:

```ts
interface PaginatedItems<T> {
  items: T[];
  pageNumber: number;   // 1-based, matches Emporix
  pageSize: number;
  hasNextPage: boolean; // true when items.length === pageSize
}
```

## Single page (`useQuery`)

```tsx
const { data } = useProducts({ pageNumber: 1, pageSize: 50 });
// data: PaginatedItems<Product>
```

## Infinite scroll (`useInfiniteQuery`)

```tsx
const {
  data,           // { pages: PaginatedItems<Product>[]; pageParams: number[] }
  fetchNextPage,
  hasNextPage,
} = useProductsInfinite({ pageSize: 50 });

const allItems = data?.pages.flatMap((p) => p.items) ?? [];
```

Cursor logic: `getNextPageParam: (last) => last.hasNextPage ? last.pageNumber + 1 : undefined`. No trailing empty fetch; termination is signalled by the last full page reporting `hasNextPage: false`.

## Iterating every item (server-side / SSR)

```ts
for await (const product of client.products.listAll({ pageSize: 100 })) {
  // …
}
```

For custom sources backed by `PaginatedItems<T>`, use the generic helper:

```ts
import { iterateAll } from "@viu/emporix-sdk";

for await (const x of iterateAll<X>((pageNumber) => fetchPage(pageNumber))) {
  // …
}
```

## Available paginated surfaces

| Service / Hook | Return type |
|---|---|
| `client.products.list` / `search` / `listAll` | `PaginatedItems<Product>` / `AsyncIterable<Product>` |
| `client.categories.list` / `productsIn` / `listAll` | `PaginatedItems<Category>` / `PaginatedItems<Product>` / `AsyncIterable<Category>` |
| `client.segments.listMyProducts` / `listMyCategories` | `PaginatedItems<Product>` / `PaginatedItems<Category>` |
| `useProducts` / `useProductsInfinite` | `PaginatedItems<Product>` |
| `useCategories` / `useCategoriesInfinite` | `PaginatedItems<Category>` |
| `useMySegmentProducts` / `useMySegmentProductsInfinite` | `PaginatedItems<Product>` |
| `useMySegmentCategories` / `useMySegmentCategoriesInfinite` | `PaginatedItems<Category>` |

## Why not absolute totals?

Emporix returns `X-Total-Count` headers on some endpoints, but the SDK does not currently expose response headers to facades. `hasNextPage` covers infinite scroll cleanly; absolute totals (for "X of Y" UIs) will be added when there's a concrete consumer that needs them.
