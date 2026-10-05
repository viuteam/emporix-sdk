---
"@viu/emporix-sdk-react": patch
---

Export `useOrderTransitions` and `UseOrderTransitionsOptions` from the package root. Since 4.1.0 they were reachable only through `@viu/emporix-sdk-react/hooks`. The JSDoc examples of `useEmporixQuery` and `useEmporixInfinite` now call methods that exist (`brands.listBrands`, `fees.list`).
