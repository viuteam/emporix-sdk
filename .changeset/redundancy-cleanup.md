---
"@viu/emporix-sdk-react": patch
---

Internal redundancy cleanup. All changes are non-breaking — public API
unchanged, all 151 React tests stay green.

**Storage**
- Extract `createListenerSet<T>()` helper used by all three backends'
  `subscribeAll` — single try/catch wrapper instead of three copies.
- Extract `parseAnonymousSession()` helper for the JSON-parse-with-fallback
  shared by localStorage and cookie backends.

**Hooks**
- `emporixKey(resource, args, ctx)` helper centralizes the
  `["emporix", resource, …args, { tenant, authKind, siteCode? }]` cache
  key shape used by 15+ Read hooks.
- `useEmporixInfinite()` helper centralizes the `initialPageParam: 1` +
  `getNextPageParam` cursor logic shared by 6 infinite-scroll hooks
  (products, categories, segments).

**Auth**
- `useCheckout` now uses the central `useReadAuth` hook instead of a
  local `checkoutCtx` helper.
- `usePaymentModes` cache key gains a stable `authKind: "customer"`
  component for consistency with other hooks.
