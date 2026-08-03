---
"@viu/emporix-sdk-next": minor
---

New server-first mode: a Next storefront can now hold **no Emporix token in the
browser**, not even an anonymous one.

Every Emporix call needs a bearer token where the call originates, so this works
the only way it can — by moving the calls, not by hiding the tokens. Server
Components read, Server Actions write, and a narrow proxy serves the public
catalog. `@viu/emporix-sdk-react` is unchanged and remains the SPA path.

New entry `@viu/emporix-sdk-next/bff`:

- `withEmporixSession` / `withEmporixSessionMutable` — bind the request's session
  and branch on it, so a Server Action is two lines. The branch matters: Emporix
  maps the anonymous token's `session-id` onto the cart at creation, so the guest
  path builds a **per-request** client with a per-guest httpOnly anonymous
  session, while the customer path reuses the memoized untagged client. Neither
  can be tagged.
- `emporixLogin` / `emporixLogout` / `emporixRefresh` — manage the session in
  httpOnly cookies. `emporixLogin` returns `void`: there is no token to
  serialize.
- `emporixTokenProxy` — the single token-rotation point, because a Server
  Component cannot write cookies and an unpersisted rotation is worthless. It
  delegates site and language to `emporixSiteProxy`.
- `assertSameOrigin` — rejects cross-site requests, and rejects a request
  carrying neither `Sec-Fetch-Site` nor `Origin`, since accepting those would
  make omitting the header the bypass. Use it in your own Route Handlers too;
  Server Actions already get Next's origin check.
- `createEmporixCatalogRoute` — a catch-all for public catalog reads whose
  allowlist is the existing `emporixTagsForUrl`. Cart, order, customer and token
  endpoints get a 403.
- `STORAGE_KEYS` is re-exported here, so a server-first storefront never has to
  import `@viu/emporix-sdk-react` just to name a cookie.

New entry `@viu/emporix-sdk-next/catalog-client` (the package's first
`"use client"` entry): `createProxyTokenProvider` and `createProxyFetch` let the
browser use catalog reads with no token at all. The token provider makes no
network call — that is the mechanism, because the SDK's default provider fetches
over the global `fetch`, which a rewriting `fetch` cannot intercept.

All secrets are `httpOnly` in this mode, including the `saasToken`, because
checkout runs server-side. `secure` is derived from the forwarded protocol rather
than hard-coded, and the cookies have bounded lifetimes — 8 h for the access
token, 30 d for the refresh token.

**The cost:** measured against `examples/storefront-demo` (17 routes, 41 hooks),
a complete storefront writes about 25 Server Actions, two lines each, and gives
up React Query for customer data in favour of `useOptimistic`.

See `examples/next-server-first` for a running demo, including a `/debug` page
that shows what the browser can actually read.
