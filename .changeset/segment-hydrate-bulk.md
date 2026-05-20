---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Segment hydrate now uses a single Emporix `POST /search` per page instead
of N+1 `GET /products/{id}` calls. New
`ProductService.searchByIds(ids, { chunkSize? }, auth?)` and
`CategoryService.searchByIds(...)` POST `/search` with
`q="id:(id1,id2,…)"`, chunking at 100 IDs by default. Adds the generic
`PaginatedItems<T>` (`{ items, pageNumber, pageSize, hasNextPage }`) in
`core/context.ts`.

**BREAKING:** `SegmentService.listMyProducts` and
`SegmentService.listMyCategories` now return `PaginatedItems<Product>` /
`PaginatedItems<Category>` instead of a flat `Product[]` / `Category[]`.
`SegmentService.listItems` gains optional `pageNumber` / `pageSize`
params (additive). `listMyProductIds` / `listMyCategoryIds` are
unchanged.

React adds four new hooks: `useMySegmentProducts` /
`useMySegmentProductsInfinite` and `useMySegmentCategories` /
`useMySegmentCategoriesInfinite`. The infinite variants use
`useInfiniteQuery` with a `pageNumber` cursor and `hasNextPage`-driven
`getNextPageParam`. All four are disabled when no customer token is in
storage.
