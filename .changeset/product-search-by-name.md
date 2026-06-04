---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

feat(product): add searchByName free-text helper + useProductNameSearch

`products.searchByName(term)` builds the Emporix `name:(~<term>)` regex filter
(escaping metacharacters) and delegates to `search`, so consumers no longer
hand-build the `q` DSL — a bare free-text term otherwise 400s with
"No value for key …". Adds the `useProductNameSearch` React hook (disabled on
empty/whitespace).
