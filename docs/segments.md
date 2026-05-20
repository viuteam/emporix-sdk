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

// 2. Hydrate sugar — fetches the real products in parallel.
const products = await client.segments.listMyProducts(
  { onlyActive: true },
  auth.customer(token),
);

// 3. Categories work the same way.
const categories = await client.segments.listMyCategories(
  { onlyActive: true },
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
```

All three are disabled when there is no customer token in storage. They
share the `["emporix", "segment", …]` query-key prefix, so invalidating
that prefix on login/logout clears the segment cache.

## Out of scope

- Admin segment CRUD (`POST/PUT/PATCH/DELETE /segments`).
- Customer-assignment writes (assign/remove a customer to/from a segment).
- Item-assignment writes (assign/remove products/categories).
- Partial-success hydrate (`Promise.allSettled` variant) — `listMyProducts`
  / `listMyCategories` reject on the first failed `get` by design.
- Bulk product fetch via a single `?q=id:(p1,p2,…)` round-trip.
