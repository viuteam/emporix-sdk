---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
"@viu/emporix-sdk-angular": minor
---

Filter the category trees.

- **`categories.listTrees(params, auth)`** sends the three filters the specification declares on `GET /category-trees`, which `tree()` never sent. `type` (`STANDARD` or `CLASSIFICATION`) arrived with the 2026-10-26 specification; `categoryIds` and `showUnpublished` were there before. `tree(auth)` keeps working and is `listTrees({}, auth)`. The new `CategoryTreeListParams` type is exported.
- **`categoryIds`** goes out comma-joined. Emporix reads that like the repeated form, which was checked against a live tenant. An empty list matches nothing and sends no request.
- **`showUnpublished`** needs `category.category_read_unpublished`. An anonymous token is refused with 403.
- **`useCategoryTree({ filter })` and `injectCategoryTree({ filter })`** pass a filter through. Angular takes it as a signal. Each filter gets its own cache entry. Without a filter, the cache key is unchanged.
- **Filter by `type` with care.** On the `viu` tenant on 2026-10-27, 27 trees came back for neither `STANDARD` nor `CLASSIFICATION`, only unfiltered.
