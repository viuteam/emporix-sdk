# @viu/emporix-sdk-next

## 0.8.1

### Patch Changes

- [#234](https://github.com/viuteam/emporix-sdk/pull/234) [`abdbf23`](https://github.com/viuteam/emporix-sdk/commit/abdbf23f1e02e21fdc942bf450481ca5a6285e15) Thanks [@amnael1](https://github.com/amnael1)! - `emporixSiteProxy` now emits `Set-Cookie` for `emporix.siteCode` and
  `emporix.language` only on a real top-level navigation.

  Before, every request that reached middleware wrote them — including a `<Link>`
  prefetch. A link to another language therefore switched the visitor's language as
  soon as it entered the viewport, and the session routes then rendered in a language
  nobody chose. Reproduced with a real Chrome prefetch against a production build.

  Detection reads `sec-fetch-mode`: `navigate` is a navigation, anything fetch-based is
  not. A missing header counts as a navigation, so old clients, `curl` and bots keep
  their behaviour. The forwarded request cookies are still injected either way, so even
  a speculative render uses the language of the URL it was asked for.

  Checking for "is this a prefetch" instead is deliberately not done: Next strips its
  own router signals — `next-router-prefetch`, `rsc`, `next-router-segment-prefetch`
  and the `_rsc` query parameter — before middleware runs, measured on Next 16.2.12. A
  prefetch is indistinguishable there from a genuine client-side navigation.

  Token rotation in `emporixTokenProxy` is deliberately **not** gated the same way: a
  visitor who navigates client-side for an hour would otherwise never rotate.

## 0.8.0

### Minor Changes

- [#225](https://github.com/viuteam/emporix-sdk/pull/225) [`8d7dd9b`](https://github.com/viuteam/emporix-sdk/commit/8d7dd9b0514242f033ec8158e97908b4cb4523bc) Thanks [@amnael1](https://github.com/amnael1)! - Two fixes from the 1'000-CCU analysis, both in this package.

  **`createEmporixPublicRoute` caches.** It called `globalThis.fetch` with no cache
  options and returned no `Cache-Control`, so every debounced keystroke in a
  typeahead was a billed Emporix call for an answer every visitor shares — while its
  own doc comment claimed «cached by Next once for all visitors». The upstream fetch
  now carries the same `next: { tags, revalidate }` a Server Component's catalog read
  gets, so the same webhook invalidates both, and the response carries
  `Cache-Control: public, s-maxage=<revalidate>, stale-while-revalidate=60`. Errors
  and the 403 for a forbidden path answer `no-store`: a 502 pinned for an hour would
  outlive the outage that caused it.

  **`timeouts` is configurable.** Neither `getEmporixClient` nor
  `withEmporixSession` could set a request budget, so every consumer ran on the SDK
  defaults — 10 s to headers, 60 s to the end of the body. At high concurrency that
  is what turns one slow Emporix minute into a process full of parked requests. The
  option is part of `getEmporixClient`'s memo key, so two budgets are two clients
  rather than whichever one asked first.

- [#224](https://github.com/viuteam/emporix-sdk/pull/224) [`6fb3a23`](https://github.com/viuteam/emporix-sdk/commit/6fb3a2302545e542303610e4e3f0f37d3cd99d8d) Thanks [@amnael1](https://github.com/amnael1)! - Share the read-only session handle within one request.

  A page view builds the handle several times for the same record — the page,
  whatever resolves the site context, `withEmporixSession` — and each build re-read
  the cookies, re-derived `Secure` from the headers, and in store mode made its own
  round trip to Redis. For data that cannot change mid-request. Measured on
  `examples/next-server-first`: `/api/session/nav` has two construction sites and
  now builds **one** handle; before this it built two.

  Read-only handles are memoized on the object `await cookies()` returns, which
  Next scopes to the request. **Mutable handles are deliberately not shared**:
  `emporixLogin` builds one, flushes it, and lets the cart onboarding build a
  second that must read what the first wrote. Collapsing those two would break
  login in store mode, where the record only exists after a flush.

  No React. `cache()` would have been the obvious tool and would have re-added the
  dependency this package removed in 0.7.0; `AsyncLocalStorage` needs someone to
  open the context, which Next does not offer a library. The `WeakMap` entry dies
  with the request because nothing else holds the anchor.

  Two limits worth knowing: the memo keys coarsely on «cookie mode» versus «store
  mode», so an app running two different stores in one process would share an entry
  — an app has one. And a rejected build is not cached, so a transient store outage
  costs one failed read rather than poisoning every later read in the request.

### Patch Changes

- [#221](https://github.com/viuteam/emporix-sdk/pull/221) [`7d95ca8`](https://github.com/viuteam/emporix-sdk/commit/7d95ca89d2c600227a3e81648353b0f46f1b2751) Thanks [@amnael1](https://github.com/amnael1)! - Docs only for the package: `examples/next-server-first` now serves its catalog
  from static, revalidated routes instead of rendering every visit, and the package
  README's server-first section gains the rule that made it possible — a
  `cookies()` read anywhere in a route's tree makes that route dynamic for good,
  including a read in the shared header.

  No package code changed. The example moved its catalog to `/[lang]/…`, turned
  `?page=` and `?variant=` into path segments, and moved the two personalised bits
  of the header into client islands backed by a new `/api/session/nav` route. The
  result, measured against `next start`: `x-nextjs-cache: MISS` then `HIT` with
  `s-maxage=3600` on category and product pages, while `/cart` stays
  `private, no-cache, no-store`.

- [#226](https://github.com/viuteam/emporix-sdk/pull/226) [`8d10ce8`](https://github.com/viuteam/emporix-sdk/commit/8d10ce8b6dd477c1b864c868d8b72c497280903e) Thanks [@amnael1](https://github.com/amnael1)! - Docs only for the package. `examples/next-server-first` now flattens the category
  tree into a cached index instead of walking it per render: the tenant's tree is
  1'631 nodes and 378 KiB of full category objects, and a category page needed three
  things out of it — a label, a breadcrumb and the direct children.

  Worth stating what this is worth now rather than repeating the number from the
  analysis: since the catalog routes moved to ISR, a render only happens on a cache
  miss, so this is a per-miss saving shared across every category path and both
  listing pages within the hour — not the per-request one it would have been before.

  `category-walk.ts` is gone with it; the walk it did per render is now done once
  per hour by `buildIndex`.

## 0.7.1

### Patch Changes

- [#219](https://github.com/viuteam/emporix-sdk/pull/219) [`248ed11`](https://github.com/viuteam/emporix-sdk/commit/248ed11cf6519a6aa30fa03d5fd4a9edddd68495) Thanks [@amnael1](https://github.com/amnael1)! - Describe what this package actually does. The `description` still listed «cache
  tags, session, webhook revalidation» — the surface as of its second release. Since
  then it gained the server-first mode (login, token proxy, session store, site
  detection), service-account clients, and it no longer needs React. npm showed the
  old sentence, so this is a published-metadata fix rather than a code change.

  The root README's package table said the same outdated thing, and its install
  section listed three of the four packages — both corrected.

## 0.7.0

### Minor Changes

- [#216](https://github.com/viuteam/emporix-sdk/pull/216) [`ca45e50`](https://github.com/viuteam/emporix-sdk/commit/ca45e50bf79ab7d72c51c0687f383bffeecfcf6d) Thanks [@amnael1](https://github.com/amnael1)! - `@viu/emporix-sdk-next` no longer depends on `@viu/emporix-sdk-react`. The peer
  dependency is gone, and the built package contains zero imports of it.

  A server-first Next app therefore installs **three** packages instead of four,
  and with them no React and no `@tanstack/react-query` — both are peers of the
  React bindings, and neither has anything to do with a mode where the browser makes
  no Emporix calls at all.

  What moved to `@viu/emporix-sdk` (`core/session-storage.ts`), completing the step
  that started with `STORAGE_KEYS`:

  | Export                                                        | Was                                                     |
  | ------------------------------------------------------------- | ------------------------------------------------------- |
  | `EmporixStorage`, `TokenStorage`, `PersistedAnonymousSession` | the session-persistence contract                        |
  | `parseAnonymousSession`                                       | parses a stored anonymous session                       |
  | `createCookieBackedStorage`, `CookieIo`                       | the whole key-to-accessor mapping                       |
  | `createServerStorage`, `ServerCookieJar`                      | an `EmporixStorage` over any cookie jar                 |
  | `serverAuth`                                                  | customer context when a token is stored, else anonymous |

  None of it imports React — `createServerStorage` fits Next, Remix, SvelteKit,
  Nitro or a plain Node handler, and it was only ever in the React package because
  that is where the browser backends live. Those stay: `createMemoryStorage`,
  `createLocalStorage`, `createSessionStorage`, `createCookieStorage` and the
  `subscribeAll` listener set are genuinely browser concerns.

  **Nothing to change in your code.** `@viu/emporix-sdk-react` re-exports every
  moved name from `./storage` and `/ssr`, with one definition only. One type is now
  derived rather than re-declared: `PersistedAnonymousSession` is
  `Pick<StoredAnonymousSession, "refreshToken" | "sessionId">`, which is what it
  always was in practice — the browser adapters deliberately persist only those two
  fields, while a server store may also keep the access token.

### Patch Changes

- [#215](https://github.com/viuteam/emporix-sdk/pull/215) [`e9d019d`](https://github.com/viuteam/emporix-sdk/commit/e9d019d4a5bf3238311dab11e5fb856ce5689004) Thanks [@amnael1](https://github.com/amnael1)! - Move the eight session keys into the core SDK: `STORAGE_KEYS` and
  `EmporixStorageKey` are now exported from `@viu/emporix-sdk`.

  They were never a React concern. The same eight strings are cookie names in a
  Next `proxy.ts`, Web Storage keys in a browser adapter, and record fields in a
  server-side session store — but they lived in `@viu/emporix-sdk-react`, which is
  why `@viu/emporix-sdk-next` depended on the React bindings to name a cookie. Six
  of the seven files in that package imported nothing else from it.

  Nothing to change in your code. `@viu/emporix-sdk-react` re-exports both from
  `./storage` and `/ssr`, and `@viu/emporix-sdk-next` still re-exports
  `STORAGE_KEYS` from `/session`. There is exactly one definition, and a test
  asserts object identity across all three paths — a copy would be the one drift
  that silently breaks a session by writing a cookie under one name and reading it
  under another.

  Measured on the built output: `@viu/emporix-sdk-next` reached for
  `@viu/emporix-sdk-react` in seven places before, and now does so in one —
  `server-session.ts`, for `createServerStorage`, `serverAuth` and the
  `EmporixStorage` type. Removing that last one (and the peer dependency with it) is
  a follow-up, because it touches a public signature.

## 0.6.1

### Patch Changes

- [#213](https://github.com/viuteam/emporix-sdk/pull/213) [`1ea2b81`](https://github.com/viuteam/emporix-sdk/commit/1ea2b81c00b6df2e4a659cf629ed5393b42c9890) Thanks [@amnael1](https://github.com/amnael1)! - Fix the multi-device cart: a cart closed by a checkout elsewhere no longer leaves
  the other devices broken.

  Emporix allows a customer one open cart per site and placing an order closes it.
  The cart id is cached per device (`emporix.cartId` in React storage, in the
  session cookie or store in Next), so every other device where that customer is
  signed in kept calling a closed cart and got `404`. It never recovered:
  `useActiveCart({ create: true })` only bootstraps when the id is `null`, and a
  stale id is not `null`. In Next it was worse — the read happens in a Server
  Component, so the `404` reached the error boundary, and `addToCart` failed
  forever because it found a non-null id and never created a new cart.

  **React.** `useCart` and `useCartMutations` treat a `404` on the **stored** id as
  «this cart is gone»: they clear `storage.cartId` and drop the `cart-bootstrap`
  cache, so the next render bootstraps a fresh cart. Silent by design — the cart no
  longer exists server-side, so the shopper sees an empty bag rather than an error.
  An explicitly passed id (`useCart("other-cart")`) never touches storage, and only
  a `404` counts: a `403` or `5xx` means «not now», not «gone».

  The emporix-scoped `retry` default no longer retries a `404` at all. It is an
  answer, not a failure, and Emporix bills the repeat — a stale cart id used to pay
  for the same answer twice on every mount.

  **Next.** `withEmporixSessionMutable` now flushes the session handle even when the
  callback throws. In store mode the handle buffers in memory and wrote once at the
  end, so a failed Server Action discarded whatever it had already set — including a
  rotated anonymous refresh token. Emporix rotates that token on every refresh, so
  the session was left pointing at one the tenant had already invalidated, the next
  request fell back to a fresh login with a new `sessionId`, and the guest lost
  their cart. Cookie mode always wrote through and was never affected. A store
  failure during the flush is swallowed rather than replacing the caller's error.

  The dead-cart-id recovery itself is documented rather than automated on the Next
  side, because a Server Component **cannot** heal it: a read-only handle does not
  write. The package README and `examples/next-server-first` show the rule — render
  the empty state on a read, clear and re-create inside the next write.

## 0.6.0

### Minor Changes

- [#211](https://github.com/viuteam/emporix-sdk/pull/211) [`9c87fa4`](https://github.com/viuteam/emporix-sdk/commit/9c87fa478368c74503f0f0b2f61b8a7b8e4a7631) Thanks [@amnael1](https://github.com/amnael1)! - Stop spending one Emporix token call per guest request.

  `AnonymousSessionStore` may now carry the anonymous **access** token and its
  expiry (`StoredAnonymousSession`: `{ refreshToken, sessionId, accessToken?,
expiresAt? }`), and `@viu/emporix-sdk-next` persists both in its httpOnly
  session cookie. A server-side guest client lives for exactly one request, so its
  in-memory token cache is always empty — before this, every single request redeemed
  the refresh token for a token the guest already held. Emporix bills per API call,
  and an anonymous token is valid for 3599 seconds on the `viu` tenant.

  Measured with a request-counting stub, guest path, one business call per request:

  |                                          | before      | after   |
  | ---------------------------------------- | ----------- | ------- |
  | first request of a session               | 1 login     | 1 login |
  | every later request                      | 1 refresh   | **0**   |
  | four `withEmporixSession` in one request | 4 refreshes | **0**   |

  A logged-in customer already cost zero token calls and still does —
  `auth.customer(token)` is passed straight through and no anonymous token is ever
  minted for them.

  Both fields are optional and the two hosts choose oppositely on purpose: the
  React storage adapters keep persisting **only** `{ refreshToken, sessionId }`,
  because a browser client is long-lived and holds the token in memory anyway, so
  writing it to `localStorage` would only expose a bearer token to JavaScript. A
  test pins that.

  `accessToken` counts only together with a future `expiresAt` — either alone is
  treated as «no token», so a truncated or hand-edited record cannot make the SDK
  send an empty bearer token. A stored token that the tenant revoked early, or one
  an out-of-sync clock made look valid, comes back as a 401 that `HttpClient`
  answers with `expireAnonymous()` plus one retry; the `sessionId` survives, so the
  guest keeps their cart. Existing sessions keep working: a cookie written before
  this release simply has neither field and refreshes exactly as it did.

## 0.5.1

### Patch Changes

- [#208](https://github.com/viuteam/emporix-sdk/pull/208) [`b58ca35`](https://github.com/viuteam/emporix-sdk/commit/b58ca35230b08db1c42f1e58874f8ea2d82684da) Thanks [@amnael1](https://github.com/amnael1)! - Document the new import service in both package READMEs, which ship in the npm
  tarballs.

  `@viu/emporix-sdk-next` gains a Route Handler that re-emits
  `client.imports.streamRun(runId)` as Server-Sent Events to the browser, including
  the abort-on-disconnect line and why this is Node runtime only. No package code
  changed: `getEmporixServiceClient` needs no per-service registration, and cache
  tags have nothing to add for a service whose reads are not cacheable.

  `@viu/emporix-sdk-react` states why admin-only services have no hooks, with the
  import service as the clearest case — every operation needs client-credentials
  with the `importtool.import_trigger` scope, and the provider is configured with a
  public storefront client id.

## 0.5.0

### Minor Changes

- [#204](https://github.com/viuteam/emporix-sdk/pull/204) [`22ae0e3`](https://github.com/viuteam/emporix-sdk/commit/22ae0e35529b52a83959e6440c911597187589c9) Thanks [@amnael1](https://github.com/amnael1)! - Renames `sessionCookieJar` to `emporixSessionHandle` and `SessionCookieJar` to
  `EmporixSessionHandle`. **Nothing breaks:** both old names are still exported,
  still the same function object, now marked `@deprecated`. They are scheduled for
  removal in 0.6.0, and a test pins the identity so dropping them has to be
  deliberate.

  The old name described one of the two backends. Pass a `store` and six of the
  eight `STORAGE_KEYS` live in the store record — only `siteCode` and `language`
  stay cookies, plus the `emporix.sid` pointer — so «cookie jar» named a quarter of
  what the thing holds. The local variable is `handle` throughout now; `jar` is left
  only where it means Next's own `await cookies()`, which genuinely is one.

  Migration is a find-and-replace:

  ```diff
  -import { sessionCookieJar, type SessionCookieJar } from "@viu/emporix-sdk-next/session";
  -const jar = await sessionCookieJar({ readOnly: true });
  +import { emporixSessionHandle, type EmporixSessionHandle } from "@viu/emporix-sdk-next/session";
  +const handle = await emporixSessionHandle({ readOnly: true });
  ```

  Two doc corrections come with it, both about what the type actually guarantees:
  «a narrow cookie surface» was only true before store mode existed, and the
  `httpOnly` promise holds for the two public keys as well — «public» means they
  stay cookies in store mode, not that JavaScript can read them. A browser-readable
  site or language cookie is `emporixSiteProxy`'s job.

## 0.4.2

### Patch Changes

- [#201](https://github.com/viuteam/emporix-sdk/pull/201) [`d5be1c9`](https://github.com/viuteam/emporix-sdk/commit/d5be1c901a3ce1c6e3309037b1602e59c81b8800) Thanks [@amnael1](https://github.com/amnael1)! - Documents session management with two diagrams in the README, which ships in the
  npm tarball — so this is a patch rather than nothing.

  The first shows where a request goes: `proxy.ts` as the only place that can read
  **and** write cookies before a render, then the split between
  `withEmporixSession` (read-only jar), `withEmporixSessionMutable` (writes, then
  flush) and `getEmporixClient()` (catalog, cacheable, no session), then the branch
  on whether a customer token is in the jar, and finally cookie mode versus store
  mode — including that `siteCode` and `language` stay cookies either way.

  The second is a sequence diagram of `emporixLogin`, because the ordering between
  its two jars is load-bearing and invisible in the code: the flush has to happen
  before cart onboarding, or the second jar reads a store with no customer token and
  runs as a guest. That was a released bug (0.4.1) and the diagram is cheaper than
  the four wrong explanations that preceded the fix.

  Both were rendered before committing, and the render caught two errors the source
  did not show: an edge that claimed store mode writes every value to a cookie, and
  a label clipped by its diamond.

## 0.4.1

### Patch Changes

- [#199](https://github.com/viuteam/emporix-sdk/pull/199) [`86c841a`](https://github.com/viuteam/emporix-sdk/commit/86c841a914ccf7d55f868df9802425d7cbf57a78) Thanks [@amnael1](https://github.com/amnael1)! - Fixes the guest-to-customer cart merge in **store mode**. A shopper who filled a
  cart as a guest and then logged in landed on an empty cart; their items stayed on
  the guest cart, unreachable.

  `emporixLogin`'s cart onboarding calls `withEmporixSessionMutable`, which builds
  its **own** jar and branches on whether a customer token is stored. In cookie mode
  `persistSession` writes through, so that jar sees the token and runs as the
  customer. In store mode it only touched the in-memory record — so the second jar
  read a store with no token yet and ran as a **guest**.

  Two consequences followed from that one branch:
  `carts.getCurrent(ctx, { create: true })` created a fresh anonymous cart instead of
  returning the customer's, and the merge never reached Emporix at all — the SDK's
  own `requireCustomerAuth` rejected the anonymous context locally.

  `emporixLogin` now flushes before onboarding. Measured against a live tenant on
  2026-08-03: a guest cart with one product, a customer already holding three, and
  after login the cart showed **4 items** under the customer's id.

  Cookie mode was never affected. A test asserts the fix on the store's **write
  order** — the customer token has to reach the store before the final write —
  because the request list cannot distinguish the two paths.

- [#199](https://github.com/viuteam/emporix-sdk/pull/199) [`e60227d`](https://github.com/viuteam/emporix-sdk/commit/e60227debc2684f9687100701b14957341769503) Thanks [@amnael1](https://github.com/amnael1)! - Fixes store mode for logged-in customers. `emporixLogin`, `emporixRefresh` and
  `emporixLogout` built their cookie jar without the `store` option, so in store
  mode they silently ran on cookies however the caller was configured.

  The effect was not a leak but a break: login wrote `customerToken`,
  `refreshToken` and `saasToken` into real browser cookies, while
  `emporixSession({ store })` read the store record — which had none of them — and
  reported the visitor as anonymous. Logged in, and every reader said logged out.

  `emporixLogout` hit the cookie-mode `destroy()` no-op, so the store record
  survived the logout. The 0.4.0 notes claimed it destroyed the record. It did not.

  Guest mode was never affected: it runs through `withEmporixSessionMutable`, which
  threads the option correctly. That is also why the feature verified clean — every
  store-mode check was a guest flow.

  Five tests cover it, each failing before the fix. One of them asserts that
  `emporixLogin` leaves **exactly one** session record: it builds two jars for one
  request, and that only works because the first flush sets the sid cookie before
  the second jar hydrates.

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
