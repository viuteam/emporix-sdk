---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add `SegmentService` (storefront reads only): `list`, `get`, `listItems`,
`listSegmentItems`, `getCategoryTree`, plus the hydrate helpers
`listMyProductIds` / `listMyCategoryIds` / `listMyProducts` /
`listMyCategories` that map segment-item ids to real `Product` /
`Category` objects via parallel `products.get` / `categories.get` calls.
All methods require a customer/raw `AuthContext` and use the shared
`requireCustomer` guard (also adopted by `customer.ts` and `payment.ts`).

React adds three lightweight hooks: `useMySegments`, `useMySegmentItems`,
`useMySegmentCategoryTree`. Each reads the customer token from the
storage and is `enabled: false` when there is no token (no network call
for guests). Exposed on the `@viu/emporix-sdk/segment` subpath.
