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

One service extends this contract: the import service reports `totalPages`, so
`client.imports` returns `ImportPage<T> = PaginatedItems<T> & { totalElements,
totalPages }` and its `hasNextPage` is derived from the totals instead of guessed
— see [import.md](./import.md#pagination). Everything below applies unchanged;
`ImportPage` is assignable to `PaginatedItems`.

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
| `client.imports.listRuns` / `listRunErrors` / `searchRecords` / `searchStreamRecords` | `ImportPage<T>` |
| `client.schema.listInstances` / `searchInstances` | `PaginatedItems<CustomInstance<T>>` |
| `client.schema.listAllInstances` | `AsyncIterable<CustomInstance<T>>` |

## Absolute totals and cursors

`PaginatedItems` carries three optional fields beyond the four above:

| field | when it is set |
|---|---|
| `totalCount` | the caller passed `totalCount: true` **and** the endpoint answered with `X-Total-Count` |
| `nextCursor` / `prevCursor` | the endpoint offers cursor pagination (today: the schema service's custom instances) |

`hasNextPage` uses whichever is most precise: a `nextCursor` means there is a next page,
a known `totalCount` gives `pageNumber * pageSize < totalCount`, and otherwise it stays
the `items.length === pageSize` guess. An **absent** cursor header means "this endpoint
does not offer cursors", not "last page".

Totals are opt-in per call rather than always on: Emporix computes the count with a second
query, so defaulting it on would put that cost on every list a storefront issues.

### Following a cursor by hand

```ts
let page = await client.schema.listInstances("shoe", { pageSize: 50 });
while (page.nextCursor !== undefined) {
  page = await client.schema.listInstances("shoe", { pageSize: 50, next: page.nextCursor });
}
```

`client.schema.listAllInstances("shoe")` does exactly this and yields the items, falling
back to page numbers on a tenant whose deployment does not send the cursor headers.

### "X of Y" counters

```ts
const page = await client.products.list({ pageNumber: 2, pageSize: 50, totalCount: true });
`Showing ${(page.pageNumber - 1) * page.pageSize + page.items.length} of ${page.totalCount}`;
```

From React, the four single-page list hooks take the same flag — `useProducts`,
`useProductSearch`, `useCategories`, `useCategorySearch`. It becomes part of the query
key, so a totals request never gets served a cached page without them. The `*Infinite`
hooks do **not** offer it: `hasNextPage` already terminates them, and a count query would
be paid on every scroll.

Three facades deliberately have no `totalCount`: `client.categories.productsIn`,
`client.segments.listMyProducts` and `client.segments.listMyCategories`. All three page
over an **assignments** list and hydrate the hits through a second call, so
`X-Total-Count` there would count assignments — including the references filtered out —
rather than the items returned. They keep the `items.length === pageSize` guess.

A total that arrives **unasked** is still reported. Some endpoints send `X-Total-Count`
whether or not the request opted in; the value is real, so the SDK surfaces it instead of
discarding it.

The import service remains the exception that needs none of this: it reports
`totalElements` and `totalPages` **in the response body**, so `ImportPage` derives
`hasNextPage` from the totals without touching a header. See
[import.md](./import.md#pagination).
