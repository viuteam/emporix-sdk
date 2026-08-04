---
"@viu/emporix-sdk": patch
"@viu/emporix-sdk-react": patch
---

`categories.tree()` and `useCategoryTree()` now return `CategoryNode[]` instead of
`Category[]`.

The declared type was factually wrong. `/category-trees` answers with the
generated `CategoryTree` shape — measured against a live tenant on 2026-08-04,
every node carried `subcategories` or nothing, and none carried `parentId`:

| | `parentId` | `subcategories` |
|---|---|---|
| `Category` | yes | no |
| `CategoryTree` / `CategoryNode` | no | yes |

So a tree node's children were invisible to consumers without a cast, while
`node.parentId` compiled and was always `undefined`. Type-only change, no runtime
difference — but code that read `parentId` off a tree node will now fail to
compile, which is the point.

`useCategoryTree` carried the same wrong type through to React consumers and is
corrected with it. `packages/react` typechecking is what surfaced it.

The doc comment on `tree()` also pointed readers to `subcategories()` for drilling
down. Both methods read `/categories/{id}/assignments` and differ only in the
`ref.type` they keep — `subcategories()` keeps `"CATEGORY"`, `productsIn()` keeps
`"PRODUCT"`. On the tenant this was measured on, the `"CATEGORY"` filter answered
empty for every category because the hierarchy lives in the trees instead, and
`childCategories()` (which hits `/categories/{id}/subcategories`) answers **404**
for a tree root. The children are inline in `subcategories`, and the comment now
says so.
