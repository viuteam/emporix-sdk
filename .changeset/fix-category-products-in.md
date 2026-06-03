---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Fix and extend the Category service for catalogue + hierarchy browsing. Several
methods targeted routes that don't exist on the deployed category service
(verified against a live tenant):

- **`categories.productsIn(...)`** requested a non-existent
  `/categories/{id}/products` route (always 404). It now resolves products via
  category **assignments** (`/categories/{id}/assignments` → keep `PRODUCT`
  refs → `/products/search`), preserving its `PaginatedItems<Product>` contract;
  categories with no products return an empty page instead of throwing.
- **`categories.tree()`** pointed at a non-existent `/categories/{...}Tree`
  route. It now reads `/category-trees` and returns the catalogue's **root
  categories** (`Promise<Category[]>`) for top-level navigation. (Return type
  changed from the previous nested-node shape; the `rootId` argument is removed.)
- **New `categories.subcategories(categoryId)`** (+ React `useSubcategories`):
  a category's direct child categories, resolved from `CATEGORY` assignment refs
  (mirrors `productsIn`). Returns `[]` when there are none.

React `useCategoryTree()` now returns `Category[]` (root categories) and takes no
`rootId`.
