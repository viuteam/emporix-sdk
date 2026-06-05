---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

feat: runtime currency switching

Adds `EmporixClient.setStorefrontContext({ currency, siteCode, targetLocation })`
to re-bind the anonymous price context at runtime (invalidating the anon session
so the next login re-mints with the new currency — covers the pre-cart guest
case `sessionContext.patch` cannot). Adds `useSiteContext().setCurrency(code)`,
which re-binds the context, clears the currency-bound guest cart, and PATCHes an
existing server session context. The storefront-demo gains a currency dropdown
populated from the active site's `availableCurrencies`.
