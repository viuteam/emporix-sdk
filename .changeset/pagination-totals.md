---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

feat(sdk): opt into absolute match counts on the list facades

Pass `totalCount: true` to any list facade to get `X-Total-Count` back as
`page.totalCount`, and an exact `hasNextPage` instead of the page-size guess.
Off by default: Emporix computes the count with a second query, so turning it
on for every list would be a silent cost on every storefront.

From React the four single-page list hooks accept the same flag — `useProducts`,
`useProductSearch`, `useCategories`, `useCategorySearch`. It is part of the query
key, so a totals request is never served a cached page without them. The
`*Infinite` hooks do not offer it: `hasNextPage` already terminates them.

Three facades deliberately keep the guess — `categories.productsIn`,
`segments.listMyProducts` and `segments.listMyCategories`. They page over an
assignments list and hydrate the hits in a second call, so a total there would
count assignments rather than the items returned.
