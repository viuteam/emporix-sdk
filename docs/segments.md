# Customer Segments

Emporix's **Customer Segment** service scopes what a logged-in customer
sees: products, categories, and (separately) coupon eligibility. A segment
is a static membership list with explicit `customer` and `item` (PRODUCT
or CATEGORY) assignments — there is no rule engine. The standard product
and category endpoints do **not** auto-filter by segment; the storefront
discovers segment items first and then fetches the real product /
category objects.

> `customer-segment` is **not** the same as `customer-group`. Groups are a
> B2B permission/role concept that drives price-list selection (see
> [`docs/auth.md`](./auth.md)). Segments scope visibility — they do not
> affect prices.

## Auth model

Every Segment endpoint in the SDK requires a customer (or `raw`) token.
The platform scope is `customersegment.segment_read_own` (carried by
standard customer tokens) — anonymous tokens are rejected at the SDK
boundary with `EmporixAuthError`. In React, the hooks are `enabled: false`
when no customer token is stored, so no network call is made for guests.

## Storefront flow

```ts
// 1. Cheapest path: just need product IDs.
const productIds = await client.segments.listMyProductIds(
  { onlyActive: true },
  auth.customer(token),
);

// 2. Hydrate sugar — one bulk `POST /products/search` round-trip per
// page (q=id:(…)). Returns a PaginatedItems<Product> with hasNextPage.
const productsPage = await client.segments.listMyProducts(
  { onlyActive: true, pageNumber: 1, pageSize: 20 },
  auth.customer(token),
);
// productsPage: { items: Product[]; pageNumber; pageSize; hasNextPage }

// 3. Categories work the same way.
const categoriesPage = await client.segments.listMyCategories(
  { onlyActive: true, pageNumber: 1, pageSize: 20 },
  auth.customer(token),
);

// 4. Navigation: a category tree built only from the customer's segments.
const tree = await client.segments.getCategoryTree(
  { siteCode: "main" },
  auth.customer(token),
);
```

The segment-item row exposes the referenced id as `item.id` (nested) plus
a `type: "PRODUCT" | "CATEGORY"` discriminator. The hydrate helpers filter
by `type` and dereference `item.id`.

## React

```tsx
const { data: segments } = useMySegments();
const { data: items }    = useMySegmentItems({ onlyActive: true });
const { data: tree }     = useMySegmentCategoryTree({ siteCode: "main" });
const { data: products } = useMySegmentProducts({ pageSize: 20 });
```

All hooks are disabled when there is no customer token in storage. They
share the `["emporix", "segment", …]` query-key prefix, so invalidating
that prefix on login/logout clears the segment cache.

## Pagination

> See [Pagination](./pagination.md) for the shared `PaginatedItems<T>` contract that all SDK list endpoints follow.

The hydrate helpers and their React hooks page through the customer's
segment items: each page is `pageSize` segment-item rows (PRODUCT or
CATEGORY), and `hasNextPage` is `true` when the source page is full.
Hydration is a single bulk call per page (`POST /<service>/{tenant}/<resource>/search`
with `q="id:(…)"`), so a page of 20 products costs **one** product
round-trip — not 20.

```ts
const page = await client.segments.listMyProducts(
  { pageNumber: 1, pageSize: 20 },
  auth.customer(token),
);
// page: { items: Product[]; pageNumber: 1; pageSize: 20; hasNextPage: boolean }
```

The React hooks expose the same shape, plus an infinite-scroll variant:

```tsx
const q = useMySegmentProductsInfinite({ pageSize: 20 });
const products = q.data?.pages.flatMap((p) => p.items) ?? [];
return (
  <>
    {products.map(/* … */)}
    {q.hasNextPage && (
      <button onClick={() => q.fetchNextPage()}>Load more</button>
    )}
  </>
);
```

Same pair for categories: `useMySegmentCategories` /
`useMySegmentCategoriesInfinite`. The `hasNextPage` flag is derived from
the **source segment-items page** being full, not from the hydrated
`items` array — a page whose source rows filter to zero PRODUCT (or
CATEGORY) items still correctly advances. Edge case: when the very last
source page happens to be exactly `pageSize` long, the next fetch
returns an empty page and `hasNextPage` flips to `false`; the infinite
scroll terminates cleanly.

## Out of scope

- Admin segment CRUD (`POST/PUT/PATCH/DELETE /segments`).
- Customer-assignment writes (assign/remove a customer to/from a segment).
- Item-assignment writes (assign/remove products/categories).
- Partial-success hydrate (`Promise.allSettled` variant) — `listMyProducts`
  / `listMyCategories` reject when the bulk `/search` round-trip fails.
