---
"@viu/emporix-sdk-next": minor
---

New entry `@viu/emporix-sdk-next/proxy` with `emporixSiteProxy`.

```ts
emporixSiteProxy(request, { siteCode: "main", language: "de" })
emporixSiteProxy(request, site, "/shoes")   // rewrite instead of pass-through
```

Lets a Next 16 `proxy.ts` resolve `siteCode`/`language` per request and have
both halves of the query key see it. Each changed value is written twice — into
the forwarded request cookies, so `emporixSession()` sees it in the current
render, and as a browser-readable `Set-Cookie`, so `createCookieStorage` seeds
the client `SiteContextProvider`. A value that already matches the incoming
cookie is skipped, so a returning visitor gets no `Set-Cookie` at all.

The two site cookies are deliberately **not** `httpOnly` — the browser must read
them or the storage precedence step in `SiteContextProvider` never fires. This
is the opposite of `emporixSessionMutable`, which defaults to `httpOnly: true`
for the customer token.

Generic by design: no host map, no locale list, no `matcher`. The package owns
the cookie mechanics, your storefront owns the routing policy. The `matcher` in
particular **cannot** be exported — Next needs a statically analysable literal
and silently ignores an imported one, so it has to be written inline in your
`proxy.ts`. Client-side, the chain needs `createCookieStorage`; with
`createMemoryStorage` only the server sees the resolved site.

Requires `@viu/emporix-sdk-react` with `COOKIE_NAMES` exported from `./ssr`.
