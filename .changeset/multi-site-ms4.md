---
"@viu/emporix-sdk-react": minor
---

Multi-site MS-4: currency + targetLocation auto-derive, preferredSite honour.

**Provider**
- `useSiteContext().currency` and `useSiteContext().targetLocation` are no
  longer always `null`. They derive from the active site's DTO
  (`site.currency` and `site.homeBase.address.country`), cached for 5
  minutes via React-Query.
- `setSite(code)` fetches the site DTO, populates `currency` /
  `targetLocation`, and includes all three fields in the
  `sessionContext.patch` body so the server is fully in sync.
- On provider mount with a pre-resolved `siteCode` (from `initialSiteCode`
  prop, storage, or static config), the site DTO is fetched once so
  `currency` and `targetLocation` populate without a user-driven switch.

**Login**
- `useCustomerSession.login` (and `socialLogin` / `exchangeToken`) now read
  `customer.preferredSite`. If it's set and differs from the active site,
  the SDK calls `setSite(preferredSite)` — same flow as a user-driven
  switch. Best-effort: a failure here never blocks login.

No breaking changes. Storefronts without `preferredSite` set on their
customers see no behavior change.
