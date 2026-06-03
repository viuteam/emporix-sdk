---
"@viu/emporix-sdk": patch
---

Fix `client.categories.productsIn(...)`, which requested a non-existent
`/category/{tenant}/categories/{id}/products` route and always 404'd. The
category service exposes products as **assignments**, so `productsIn` now
fetches `/categories/{id}/assignments`, keeps the `PRODUCT` references, and
resolves them to full products via `/products/search` — preserving its
`PaginatedItems<Product>` contract (pagination follows the assignments page).
Categories with no product assignments now return an empty page instead of
throwing.
