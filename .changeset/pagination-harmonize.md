---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Harmonize all paginated SDK surfaces on `PaginatedItems<T>`. Removes the
legacy `Page<T>` shape (whose `total` was always `NaN`, since the HTTP
client never exposed `X-Total-Count`) and the `paginate()` async
iterator.

**BREAKING:**
- `ProductService.list` / `ProductService.search` now return
  `PaginatedItems<Product>` (`{ items, pageNumber, pageSize, hasNextPage }`)
  instead of `Page<Product>` (`{ items, total, offset, limit }`).
- `CategoryService.list` returns `PaginatedItems<Category>`;
  `CategoryService.productsIn` returns `PaginatedItems<Product>`.
- `useProducts` / `useCategories` now resolve to `PaginatedItems<T>`.
- `Page<T>` and `paginate()` are no longer exported from `@viu/emporix-sdk`.

**Fixed:**
- `useProductsInfinite` previously over-fetched a trailing empty page
  before terminating, and its `getNextPageParam` was tied to the
  fetched-page count rather than the cursor. It now derives the next
  page from `last.hasNextPage` / `last.pageNumber + 1` — same pattern as
  the segment-hydrate infinite hooks.

**Added:**
- `useCategoriesInfinite` — mirror of `useProductsInfinite`.
- `iterateAll<T>(fetchPage, start?)` async iterator over
  `PaginatedItems<T>`. Replaces `paginate()` for "iterate every item
  across pages" use cases.

**Migration:**

```ts
// Before
const { items, total } = await client.products.list({ pageNumber: 1, pageSize: 50 });
// total was always NaN.

// After
const { items, hasNextPage } = await client.products.list({ pageNumber: 1, pageSize: 50 });
```

```ts
// Before
for await (const p of paginate((offset, limit) => svc.list(...), 50)) { ... }

// After
for await (const p of svc.listAll({ pageSize: 50 })) { ... }
// or, for custom sources:
for await (const x of iterateAll<X>((pageNumber) => fetchPage(pageNumber))) { ... }
```
