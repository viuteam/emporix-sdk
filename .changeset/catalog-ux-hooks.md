---
"@viu/emporix-sdk-react": minor
---

Add four catalog-UX hooks to `@viu/emporix-sdk-react`:

- `useProductByCode(code)` — single-product lookup via the `code` field. For slug-based routes (`/products/[slug]`).
- `useProductSearch(query, params?)` — full-text product search. Disabled on empty query; pair with consumer-side debouncing.
- `useProductsInCategory(categoryId, params?)` — paginated products for a category landing page.
- `useProductsInCategoryInfinite(categoryId, params?)` — infinite-scroll variant of the same.

All four follow the established `useReadAuth` + `enabled`-gate patterns. No SDK change.
