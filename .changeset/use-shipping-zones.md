---
"@viu/emporix-sdk-react": minor
---

Add `useShippingZones` — lists the tenant's configured shipping zones with their
active methods and fees in a single call (`expand=methods,fees`,
`activeMethods=true`). Auto-detects auth (customer token if stored, otherwise
anonymous), so storefronts can show delivery options to guests and customers
alike. The site defaults to the provider's active `siteCode`.
