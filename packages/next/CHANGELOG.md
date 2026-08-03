# @viu/emporix-sdk-next

## 0.4.0

### Minor Changes

- [#195](https://github.com/viuteam/emporix-sdk/pull/195) [`d525042`](https://github.com/viuteam/emporix-sdk/commit/d525042ed190be33645054c82806df8d8196e925) Thanks [@amnael1](https://github.com/amnael1)! - `emporixLogin` now adopts the customer's cart and merges the guest cart into it,
  matching what `@viu/emporix-sdk-react` already does on login.

  This fixes a crash found in live testing: a customer whose `emporix.cartId`
  cookie was absent — after a checkout closed the previous cart, or after the
  cookie expired — fell through to `carts.create`, and Emporix answered **409
  Conflict**, because a customer may hold only one open cart. Login now calls
  `carts.getCurrent({ create: true })`, which returns the existing cart or makes
  the first one.

  The merge is the other half: a guest who fills a cart and then logs in keeps
  those items instead of silently losing them.

  Both are best-effort — a cart in a bad state never costs the customer their
  login — and both are skipped when no `siteCode` is configured, since
  `getCurrent` requires one.

- [#195](https://github.com/viuteam/emporix-sdk/pull/195) [`c3ed244`](https://github.com/viuteam/emporix-sdk/commit/c3ed24441d995551973f56ef7fc8ad6fb51acd74) Thanks [@amnael1](https://github.com/amnael1)! - The browser-side proxy entry is `@viu/emporix-sdk-next/public-client`, not
  `/catalog-client`, and its route factory is `createEmporixPublicRoute` rather
  than `createEmporixCatalogRoute`.

  Neither was published — both are new on the branch that introduced them — so
  there is nothing to migrate.

  `catalog` named the first use case, not the rule. Two problems came with it:
  - **Wrong scope.** The route allows exactly what `emporixTagsForUrl` yields tags
    for, which is the "public and cacheable" test: `product`, `category`, `price`,
    `availability` and `site`. Prices and site configuration are not what anyone
    calls catalog data.
  - **Name collision.** Emporix has a real Catalog service, exposed as
    `client.catalogs`. `catalog-client` read as a client for it. It is not.

  `createProxyTokenProvider` and `createProxyFetch` keep their names — they do
  proxy.

- [#195](https://github.com/viuteam/emporix-sdk/pull/195) [`72beab4`](https://github.com/viuteam/emporix-sdk/commit/72beab47a3fd85c49643cb38158854c03fa3ffb9) Thanks [@amnael1](https://github.com/amnael1)! - New server-first mode: a Next storefront can now hold **no Emporix token in the
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

- [#195](https://github.com/viuteam/emporix-sdk/pull/195) [`9a5a938`](https://github.com/viuteam/emporix-sdk/commit/9a5a938519843199dbc2597c5a8fd9ca3907f050) Thanks [@amnael1](https://github.com/amnael1)! - The server-first entry is `@viu/emporix-sdk-next/session`, not `/bff`.

  `/bff` was never published — it exists only on the branch that introduced it —
  so nothing to migrate. The rename happened because the name was wrong twice
  over: the documentation calls this «server-first mode» everywhere, so a reader
  had to learn two names for one thing; and «Backend for Frontend» describes a
  separate deployable service per client type, which this is not — it is a set of
  helpers running inside the same Next app.

  `emporixSession` / `emporixSessionMutable` are now exported from `/session`
  alongside `withEmporixSession` / `withEmporixSessionMutable`, where the two
  families read as the pair they are: one returns the session values, the other
  runs a callback with the session bound. Both remain exported from the package
  root, where they shipped in 0.3.0.

  Renamed with the entry, since «bff» should not survive in the API surface:

  | Before         | After              |
  | -------------- | ------------------ |
  | `BFF_MAX_AGE`  | `SESSION_MAX_AGE`  |
  | `bffCookieJar` | `sessionCookieJar` |
  | `BffCookieJar` | `SessionCookieJar` |

  Cookie **names** are untouched — only the constants holding them changed, so
  existing browser sessions survive.

- [#197](https://github.com/viuteam/emporix-sdk/pull/197) [`87e4580`](https://github.com/viuteam/emporix-sdk/commit/87e45805bf5e31a5f8dcdd8b1baa4cbea5651430) Thanks [@amnael1](https://github.com/amnael1)! - Three changes to the session cookies, shipped together because two of them
  invalidate every running session and nobody should be logged out twice.

  **An absolute session ceiling of 90 days.** The idle window was never a limit:
  `persistSession` rewrites the refresh cookie on every refresh, so the documented
  30 days meant 30 days of _inactivity_ and an actively used session never
  expired. `emporix.sessionStartedAt` is stamped at login and never rewritten;
  `emporixRefresh` clears the session and returns `null` once the ceiling is
  passed. Sessions that predate this are adopted rather than dropped on deploy.

  **The `__Host-` prefix** on every session cookie, which makes the browser
  enforce Secure, Path=/ and no Domain — a compromised subdomain can no longer
  inject a cookie for the parent domain. Dropped automatically over plain http,
  where browsers refuse the prefix. Reads accept the bare name as a fallback, so
  sessions written before this survive.

  **Optional AES-256-GCM encryption**, on when `EMPORIX_COOKIE_SECRET` holds a
  comma-separated list of base64url 32-byte keys. The first encrypts, all decrypt,
  so keys rotate without logging everyone out — and removing a key is a
  mass-logout lever the stateless design otherwise lacks.

  ```bash
  node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
  ```

  What encryption buys, stated honestly: a stolen ciphertext cannot be redeemed
  directly against Emporix, only replayed against your app, where you can
  rate-limit and log. It does **not** prevent session hijacking.

  **Turning encryption on logs every session out.** There is deliberately no
  plaintext fallback: with a 30-day refresh cookie it would have to stay open for
  30 days, and integrity protection for `cartId` and `activeLegalEntityId` would
  be worthless for that whole window.

  **Read session cookies through `sessionCookieJar`, not `cookies()`.** This is the
  one footgun the feature introduces, and it fails quietly: with no secret set both
  forms work, so a raw `cookies().get(STORAGE_KEYS.cartId)` passes review and only
  breaks when someone enables encryption — at which point it returns the ciphertext
  and hands Emporix a cart id it has never seen. Use
  `sessionCookieJar({ readOnly: true })` in Server Components and
  `sessionCookieJar()` in Server Actions.

- [#198](https://github.com/viuteam/emporix-sdk/pull/198) [`bf3befd`](https://github.com/viuteam/emporix-sdk/commit/bf3befdeaabd51346ec5e8c5c70728cbd44a8823) Thanks [@amnael1](https://github.com/amnael1)! - Session values can now live in a store you provide instead of in cookies. Pass
  `store` and the browser keeps one opaque `emporix.sid`; everything else moves
  server-side.

  ```ts
  const store: EmporixSessionStore = {
    read: async (id) => …,
    write: async (id, record, ttlSeconds) => …,
    destroy: async (id) => …,
  };
  ```

  Three methods, and the package ships no implementation — that is what keeps it at
  zero runtime dependencies. `examples/next-server-first` has a Redis one to copy.

  **What this buys that encrypted cookies cannot:** deleting a single session.
  `emporixLogout` destroys the record, and an operator holding the id can too.

  It also removes three problems rather than mitigating them: the 4 KB per-cookie
  limit no longer applies to the `saasToken`, its JWT payload never reaches the
  browser, and `cartId` / `activeLegalEntityId` — the values the app itself trusts —
  are not in the browser to tamper with.

  Lifetimes are time-remaining, so a key dies exactly when its session does:
  `SESSION_ABSOLUTE_MAX` minus time spent for a customer, a sliding
  `SESSION_GUEST_MAX` (7 days) for a guest. Guests get a shorter window because in
  store mode every visitor costs a key.

  **Pass `store` to all three readers** — `withEmporixSession*`,
  `emporixTokenProxy` and `emporixSession`. Forget it in one place and that place
  silently falls back to cookie mode.

  **The `withEmporixSession*` callback now receives the jar as a third argument.**
  Use it rather than building your own with `sessionCookieJar()`: a second jar for
  the same request mints its own session id and needs its own flush. Existing
  callbacks that ignore the argument keep working.

  **`EMPORIX_COOKIE_SECRET` is not applied in store mode.** Sealing a random id
  buys nothing. Cookie mode keeps encryption unchanged.

  **No admin API.** The store makes revocation possible; it is not shipped as a
  feature. Revoking every session of one customer needs a `customerId → sid[]`
  index, which your store can build from the record.

  Also fixes a cookie-mode bug found while verifying this: turning encryption
  **off** left sealed cookies being read as plaintext, so a `v1.…` ciphertext was
  handed on as if it were a cart id. A sealed value with no key configured now
  reads as absent.

## 0.3.0

### Minor Changes

- [#191](https://github.com/viuteam/emporix-sdk/pull/191) [`5fd71d4`](https://github.com/viuteam/emporix-sdk/commit/5fd71d4a4f9bd1e3e447276124bb0ea48635df5c) Thanks [@amnael1](https://github.com/amnael1)! - New entry `@viu/emporix-sdk-next/proxy` with `emporixSiteProxy`.

  ```ts
  emporixSiteProxy(request, { siteCode: "main", language: "de" });
  emporixSiteProxy(request, site, "/shoes"); // rewrite instead of pass-through
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

  Requires `@viu/emporix-sdk-react` with `STORAGE_KEYS` exported from `./ssr`.

- [#194](https://github.com/viuteam/emporix-sdk/pull/194) [`a7284e5`](https://github.com/viuteam/emporix-sdk/commit/a7284e59a3f25b19863d280f9880a8b256248f70) Thanks [@amnael1](https://github.com/amnael1)! - New entry `@viu/emporix-sdk-next/service` with `getEmporixServiceClient`, for
  server-side writes with a dedicated Emporix service account.

  ```ts
  export const service = getEmporixServiceClient({
    credentials: {
      productWriter: {
        clientId: "…",
        secret: "…",
        scope: "product.product_create",
      },
    },
  });
  await service.products.create(input, {}, auth.service("productWriter"));
  ```

  Returns a plain `EmporixClient`, memoized per option set, so the SDK's token
  handling applies: one cached token per credential set, reused until `expires_in`
  minus a 60-second buffer, behind a single-flight lock. All of that lives on the
  client instance, so the memoization is the feature — a client built inside a
  handler body fetches a token per request.

  **Importing this entry from a `"use client"` module fails the build.** The entry
  carries a secret, so its `exports` map resolves to a throwing file outside the
  server graph. Verified against a real Turbopack build: the client import fails in
  the `app-client` and `app-ssr` layers, while Route Handlers, Server Actions and
  Server Components resolve normally. No `server-only` dependency was added — the
  package still has none.

  Note that the error arrives at build time rather than in your editor.
  TypeScript does not understand the `react-server` condition, so `types` resolves
  unconditionally to the real declarations; otherwise `tsc` would fail even in a
  legitimate Route Handler.

  **No `tagged` option, deliberately.** A service client never receives a `fetch`,
  because Next's fetch cache does not key on `Authorization` and a cached
  privileged GET would be served to other visitors. No `context` option either:
  `context` belongs to `StorefrontCredentials`, and a service client has none.

  A credential set with an empty `clientId` or `secret` is rejected up front with
  the set name. An unset environment variable yields `""`, which Emporix answers
  with a 401 that reads like a permissions problem.

## 0.2.0

### Minor Changes

- [#186](https://github.com/viuteam/emporix-sdk/pull/186) [`edc5c2c`](https://github.com/viuteam/emporix-sdk/commit/edc5c2ce5cd8ea0a1efde060dbfeebe8c4df8a86) Thanks [@amnael1](https://github.com/amnael1)! - Initial release. Next.js server-side bindings for the Emporix SDK.
  - `getEmporixClient()` — a memoized `EmporixClient` per process (never per
    request) whose `fetch` attaches Next cache tags to cacheable catalog GETs.
    `getEmporixClient({ tagged: false })` is the untagged variant and is required
    for anything carrying a customer token: Next's fetch cache does not key on the
    `Authorization` header, and the wrapper cannot tell an anonymous from a
    customer request.
    Accepts `tenant`, `clientId`, `host`, `tagged`, `revalidate` and `context`
    (`currency` / `siteCode` / `targetLocation` / `language`, bound at anonymous
    login and required for prefetch-key parity with the client provider). All six
    are covered by the memoization key.
  - `emporixSession()` / `emporixSessionMutable()` — the Emporix session from
    `next/headers` cookies, read-only for Server Components and read-write with
    `httpOnly`/`secure`/`lax` defaults for Server Actions and Route Handlers.
  - `emporixTags` / `emporixTagsForUrl` — the tag vocabulary and the URL mapping.
    Tags are derived centrally from the request URL rather than passed per call,
    because the SDK has 596 request call sites.
  - `@viu/emporix-sdk-next/webhook` — `verifyEmporixSignature`, `canonicalJson` and
    `createEmporixWebhookRoute`, which revalidates the affected tags. The signature
    is HMAC-SHA256 base64 over the **canonically re-serialized** body (keys sorted,
    nested included), matching Emporix's documented example — a verifier written
    against the raw bytes rejects every real delivery. Not yet verified against live
    traffic; smoke-test one delivery, and pass `canonicalize: false` if your tenant
    signs raw bytes.
  - **Requires Next 16.** Next 16 made `revalidateTag`'s second `cacheLife`
    argument mandatory. `createEmporixWebhookRoute` defaults it to `{ expire: 0 }`
    — immediate expiry, which the Next docs prescribe for webhook-driven
    invalidation — and exposes `profile` to choose `"max"` (stale-while-revalidate)
    instead.

  Requires `@viu/emporix-sdk` with `EmporixConfig.fetch`. No runtime dependencies.

## 0.1.0

Bootstrap publish, done by hand and therefore without npm provenance.

npm trusted publishing is configured per package and cannot be set up for a
package that does not exist yet, so the first version had to be published
manually to create the package. `0.2.0` above is the first release from the
pipeline, with provenance. There is no functional difference between the two.
