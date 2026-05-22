---
"@viu/emporix-sdk-react": minor
---

API-quota reduction: sane QueryClient defaults + bootstrap deduplication.

**QueryClient defaults** (only applied when no `queryClient` prop is passed):
- `staleTime: 30s` — fresh-within-30s policy reduces refetch-on-mount churn.
- `refetchOnWindowFocus: false` — tabbing back no longer refetches all queries.
- `retry: 1` — single retry on failure instead of three (caps failed-request
  cost at 2× per query).

**Per-hook staleTime overrides:**
- `useSites`, `useDefaultSite`, `usePaymentModes` — 10 min.
- `useCategory(ies)`, `useCategoryTree`, `useProductsInCategory(Infinite)`,
  `useMySegment*` — 5 min.
- `useProducts(Infinite)`, `useProduct`, `useProductByCode`, `useProductSearch`,
  `useMatchPrices` — 60 s.
- `useCustomerSession.customer` (meQuery) — 30 s.
- Cart, Addresses keep the 30s default (or 0 where freshness matters).

**Bootstrap dedup:**
- `useActiveCart({ create: true })` and `useCustomerSession.login` cart
  onboarding share a single `bootstrapCart` cache entry — parallel mounts
  trigger one server call instead of N.
- `useCustomerSession.login` honours `customer.preferredSite` via the same
  `meQuery` cache key — login fires 1 `GET /customer/me` when the cache hits,
  2 in the worst-case timing race (vs always 2 before).

No breaking changes. Consumers passing their own `queryClient` to
`EmporixProvider` keep their existing defaults.
