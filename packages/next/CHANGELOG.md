# @viu/emporix-sdk-next

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
