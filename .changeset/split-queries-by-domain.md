---
"@viu/emporix-sdk-react": patch
---

Refactor `hooks/queries.ts` into domain-aligned files (`use-products.ts`, `use-categories.ts`, `use-cart.ts`) matching the rest of the package. The shared `useReadAuth` helper now lives in `hooks/internal/use-read-auth.ts`. `use-cart-mutations.ts` is consolidated into `use-cart.ts`, which now holds every cart hook (read + mutations + create).

**Fix:** `useCategoriesInfinite` is now re-exported from the package root. It was defined but not exported in the prior release.

No public hook name, behavior, or query-key changed. Consumer imports from `@viu/emporix-sdk-react` continue to work.
