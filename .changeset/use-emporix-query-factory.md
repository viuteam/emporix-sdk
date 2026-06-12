---
"@viu/emporix-sdk-react": patch
---

internal refactor: the standard read hooks now share a single `useEmporixQuery` factory that encapsulates auth-context resolution, site discriminators, query-key assembly, and default options. No observable behavior or API change — query keys, `enabled` gates, and `staleTime` values are identical; the existing hook test suites pass unchanged. Hooks with a non-standard auth shape (`useCustomerOnlyCtx` throw-on-missing — approvals/returns; caller-supplied `authCtx` — sales-order) and all infinite/bespoke-key hooks are intentionally left as-is.
