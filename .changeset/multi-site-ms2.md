---
"@viu/emporix-sdk-react": minor
---

Multi-site MS-2: observable site context + cache-key migration.

**Provider**
- `<EmporixProvider initialSiteCode>` prop — resolution order: prop →
  `storage.getSiteCode()` → static `client.config.…context.siteCode` →
  `null`.

**Hooks**
- `useSiteContext()` — returns `{ siteCode, currency, targetLocation,
  setSite }` for the active site. In MS-2 `currency` and `targetLocation`
  are `null` (populated in MS-4). `setSite(code)` writes storage, clears
  `storage.cartId` (carts are site-aware), and invalidates all
  `["emporix"]` queries.

**Storage**
- `EmporixStorage.{get,set}SiteCode` across all three backends (memory,
  localStorage, cookie). localStorage key: `emporix.siteCode`.

**Cache keys**
- All site-aware query keys (`useProducts`, `useCategories`, `useCart`,
  `useActiveCart`, `useCartMutations`, `useMatchPrices`, `useMySegment*`,
  `usePaymentModes`, etc.) now include `siteCode`. Different sites =
  separate cache entries. Internal change — no consumer subscribed
  directly to query keys.

No breaking changes. Existing single-site apps work unchanged — they
implicitly run with the static config's `siteCode` (or `null`).
