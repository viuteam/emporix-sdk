---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add a runtime language switch. `client.setStorefrontContext({ language })` now sets an `Accept-Language` header on every read. React's `useSiteContext()` exposes `language` + `setLanguage(lang)` (modeled on `setCurrency`), persists the choice via `EmporixStorage` (`emporix.language`), mirrors it into the server session context, and keys localized reads (products, categories, segments, cart, shopping lists, orders) by language so the cache never serves stale-language text. A new `initialLanguage` provider prop seeds the active language.
