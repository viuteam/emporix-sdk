---
"@viu/emporix-sdk-react": patch
---

Internal refactor: split the oversized `EmporixProvider` (557 LOC) and
`CompanyContextProvider` (248 LOC) into focused internal hooks and co-located
type/site-context modules. `EmporixProvider` is now a composition facade
(`useEmporixQueryDefaults`, `useProviderWiring`, `useTelemetrySource`,
`useCustomerTokenRefresher`) and `SiteContextProvider` lives in its own module
with a de-duplicated switch tail. No change to the public API, rendered output,
effect timing, or types — all 298 unit tests pass unchanged.
