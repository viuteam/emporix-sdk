---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add Site Settings Service binding — first stage of multi-site foundation.

**SDK**
- `client.sites.list()` — list active sites for the tenant.
- `client.sites.get(code)` — retrieve one site by code.
- `client.sites.current()` — convenience for the `default: true` site.
- New `Site` type mirroring the `SiteDto` schema (code, name, active,
  default, currency, languages, homeBase, shipToCountries, …).

**React**
- `useSites()` — list active sites.
- `useDefaultSite()` — the default site.

No breaking changes. The active-site runtime context (provider state,
`setSite`, cache-key migration) follows in MS-2.
