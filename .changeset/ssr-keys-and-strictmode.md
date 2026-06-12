---
"@viu/emporix-sdk-react": patch
---

fix the RSC/SSR prefetch pipeline and StrictMode safety: `prefetchProduct`/`prefetchCart`/`prefetchOrder` now build their query keys through the same `emporixKey` builder the hooks use (previously the keys never matched — `siteCode`/`language`/company discriminators were missing — so hydration was always a cache miss and the client refetched); new `siteCode`/`language`/`activeCompanyId` options mirror the client context. The provider's anonymous-store wiring and `initialCustomerToken` seed now re-run when the `client`/`storage` props change and no longer execute inside `useMemo`; the fallback QueryClient is held in state (a dropped memo cache could previously discard the whole query cache). CompanyContext bootstrap is cancellation-safe under StrictMode and company switches are serialized — the token-rotating refresh can no longer double-fire with the same refresh token.
