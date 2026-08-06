# Site and Locale Detection in the Proxy — Design

**Status:** approved
**Date:** 2026-07-31
**Package:** `@viu/emporix-sdk-next`
**Predecessors:** `2026-07-31-emporix-sdk-next-design.md` (Follow-up 2),
`2026-07-31-next-example-migration-design.md` (Follow-up 1),
`2026-07-31-react-key-normalization-design.md` (Follow-up 1)

## Problem

A storefront that serves more than one site or language has to determine
`siteCode` and `language` per request before rendering. Both values feed into
two places that have to agree:

- server-side into `getEmporixClient({ context })` and into the
  `prefetchEmporix` query keys,
- client-side into the `SiteContextProvider`, out of which `useEmporixQuery`
  writes them into the same key via `siteMeta`.

If they diverge, the hydration cache hit turns into a miss and every page loads
its data twice. This is the same mechanism the `context` option in
`getEmporixClient` was built for (PR #187/#188) — only here it is per request
instead of per process.

A `proxy.ts` is the only place where this can happen before rendering
takes place.

## Measured Foundations

Everything measured against `next@16.2.12` in the repo, not from memory.

| Fact | Source |
|---|---|
| File is named `proxy`, in the root or in `src/` | `next/dist/lib/constants.d.ts:32` — `PROXY_FILENAME = "proxy"`, `PROXY_LOCATION_REGEXP = "(?:src/)?proxy"` |
| Export as `default` **or** named `proxy`; type `NextProxy` from `next/server` | `next/dist/build/analysis/get-page-static-info.js:270-306`, docs |
| **Node runtime enforced** — `export const runtime` throws | «Route segment config is not allowed in Proxy file … Proxy always runs on Node.js runtime» (`get-page-static-info.js:587`) |
| Without a `matcher` the proxy runs on every request, incl. `_next/static`, `_next/image`, `public/` | Docs, section «Matcher» |
| `matcher` has to be a statically analysable literal | Docs: «The matcher values need to be constants so they can be statically analyzed at build-time. Dynamic values such as variables will be ignored.» |
| `request.cookies.set(name, value)` writes the request's `cookie` header back | `next/dist/compiled/@edge-runtime/cookies/index.js:212-217` — `this._headers.set("cookie", …)` |
| The request header is passed on via `NextResponse.next({ request: { headers } })`, not via `{ headers }` | Docs, section «Setting Headers» |
| `NextResponse.rewrite(dest)` validates `dest` as an absolute URL and puts it into `x-middleware-rewrite` | `next/dist/server/web/spec-extension/response.js:116-118` |
| `next/root-params` exists in 16.2.12 | `next/dist/server/request/root-params.js` |
| Next advises against Proxy | Docs: «We recommend users avoid relying on Middleware unless no other options exist» and «you should not attempt relying on shared modules or globals» |
| `next@^16.2.12` is already a devDependency in `packages/next` | `packages/next/package.json` |

Four of them were not merely looked up but executed in a spike and deleted
again afterwards — `Request.headers` is guarded in the web standard, so
«`request.cookies.set` is allowed» was a load-bearing assumption and not a
given:

| Measured | Result |
|---|---|
| `request.cookies.set` on a fresh `NextRequest` | allowed; `request.headers.get("cookie")` contains `emporix.language=de` afterwards |
| existing cookie in the incoming `cookie` header | is preserved, the new one is added to it |
| `NextResponse.next({ request: { headers } })` with the mutated headers | works; `set-cookie` contains **no** `HttpOnly` |
| `NextResponse.rewrite(new URL("/x", request.url), …)` | `x-middleware-rewrite` is `https://shop.test/x` |

The `HttpOnly` assertion was mutated (`httpOnly: true` set) and then fails
exactly once — so the guard from test 9 below really can fail.

The existing cookie chain, likewise looked up:

| Fact | Source |
|---|---|
| The `SiteContextProvider` reads `storage.getSiteCode()` / `getLanguage()` as the **second** precedence level, after the `initial*` props and before the client-config context | `packages/react/src/site-context.tsx:55-68` |
| `useEmporixQuery` takes `siteCode`/`language` from this context and puts them into the key via `siteMeta` | `packages/react/src/hooks/internal/use-emporix-query.ts:45,57` |
| `emporixSession()` reads the same cookie names server-side via `createServerStorage` | `packages/next/src/session.ts` |
| `COOKIE_NAMES` is today exported from **no** entry of `@viu/emporix-sdk-react` | `packages/react/src/storage/cookie-core.ts:12`, no re-export in `index.ts` / `ssr.ts` / `storage/index.ts` |
| The `./storage` entry carries the `"use client"` banner, `./ssr` deliberately does not | `packages/react/tsup.config.ts`, `packages/react/scripts/check-dist.mjs` |

## Decision: generic, no policy share

The package owns the Emporix mechanics exclusively. Which host or path points
to which `siteCode`/`language` is written by the storefront itself.

Rationale: `@viu/emporix-sdk-next` is published and is meant to carry several
future storefronts. A host map or locale convention in the package would be the
policy of exactly one storefront, baked into an npm version — and every further
storefront would have to work around it instead of using it.

Where the resolver lives has one consequence that belongs in the README: **if a
resolved site diverges from the existing cookie, the function overwrites it.**
Anyone who does not want to run over a client-side language choice
(`setLanguage`) reads `request.cookies` first in the resolver and returns the
existing value. This is deliberately not solved in the package — whether the URL
or the user's choice wins is a product decision, not a library decision.

The proxy must furthermore make **no** Emporix call and must not import
`getEmporixClient`. That is not caution but the Next docs: the client memoises
in a module map, and for Proxy «you should not attempt relying on shared modules
or globals» applies. Resolution is therefore purely synchronous out of the
request.

## Surface

A new entry `@viu/emporix-sdk-next/proxy` with one export.

```ts
/**
 * Site and language that a proxy has resolved for a request.
 * Missing fields are left untouched — there is no deleting.
 */
export interface EmporixSite {
  siteCode?: string;
  language?: string;
}

export function emporixSiteProxy(
  request: NextRequest,
  site: EmporixSite,
  rewriteTo?: string | URL,
): NextResponse;
```

`rewriteTo` omitted → `NextResponse.next(...)`. `rewriteTo` set →
`NextResponse.rewrite(...)`, relative strings are resolved against
`request.url`. Both paths run through the same header injection and the same
cookie write.

Redirect is deliberately not covered: no render takes place, so no header
injection is needed, and the `Set-Cookie` travels along with the redirect to the
follow-up request.

### Implementation

```ts
const ENTRIES = [
  ["siteCode", COOKIE_NAMES.siteCode],
  ["language", COOKIE_NAMES.language],
] as const;

export function emporixSiteProxy(
  request: NextRequest,
  site: EmporixSite,
  rewriteTo?: string | URL,
): NextResponse {
  const changed: Array<[string, string]> = [];
  for (const [field, name] of ENTRIES) {
    const value = site[field];
    if (value === undefined) continue;
    if (request.cookies.get(name)?.value === value) continue;
    // Writes the `cookie` header back so that `emporixSession()` sees the
    // value already in THIS render.
    request.cookies.set(name, value);
    changed.push([name, value]);
  }

  const init = { request: { headers: request.headers } };
  const response =
    rewriteTo === undefined
      ? NextResponse.next(init)
      : NextResponse.rewrite(new URL(rewriteTo, request.url), init);

  for (const [name, value] of changed) {
    response.cookies.set(name, value, {
      path: "/",
      sameSite: "lax",
      // NOT httpOnly: the browser-side createCookieStorage has to be able to
      // read it, otherwise the storage precedence level in the
      // SiteContextProvider never kicks in.
      httpOnly: false,
      secure: request.nextUrl.protocol === "https:",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return response;
}
```

Three details with a rationale:

**`httpOnly: false` explicitly**, even though it is the default of
`ResponseCookies.set`. It is the only security-relevant line in the file;
written out explicitly it documents itself and survives a default change in
Next. The contrast to `emporixSessionMutable` (`httpOnly: true`) is
intentional: the browser must not read the customer token, but it must read the
site preference.

**`secure` derived from the protocol**, not hard-wired `true`. Hard-wired `true`
yields a silently discarded cookie on an HTTP staging environment —
fail-closed and tedious to diagnose. Behind a TLS-terminating
reverse proxy Next sees `http:` and sets no `Secure`; that is fail-open and
belongs in the JSDoc.

**No-op guard** when the incoming cookie already matches. For the returning
visitor no `Set-Cookie` arises at all — otherwise every response would be
uncacheable on some CDNs. If nothing was changed, the call is a pure
pass-through.

### Its own entry, not out of cosmetics

`src/session.ts` imports `next/headers`, and `cookies()` is not available in
the proxy context. Via the barrel export a `proxy.ts` would drag that along
with it. The same rationale as with the existing `webhook` entry.

Changes: extend `entry` in `packages/next/tsup.config.ts` with
`proxy: "src/proxy.ts"`, add `"./proxy"` to the `exports` map of
`packages/next/package.json`.

## Data Flow

```
proxy.ts  →  emporixSiteProxy
               ├─ request.cookies.set  →  cookie header  →  emporixSession()
               │                                          →  prefetchEmporix({ siteCode, language })
               └─ response.cookies.set →  Set-Cookie      →  createCookieStorage
                                                          →  SiteContextProvider
                                                          →  siteMeta  →  query key
```

Both halves flow into the same `siteMeta`, so server prefetch and client
hydration match. No new plumbing code arises — the chain exists, the proxy
hooks itself onto the front of it.

The double write is not redundant. Without the request half the running render
does not see the new value and prefetches with the old one. Without the
`Set-Cookie` the browser never has the value on the first visit, the client
mounts without `siteCode`, and precisely that first page view misses the key.

### Client-side prerequisite

The lower half only works with `createCookieStorage`. With
`createMemoryStorage` — which `examples/next-app-router` uses today — it is
dead. That belongs in the README, not in code: it is a decision of the
storefront.

### The one export needed in `@viu/emporix-sdk-react`

`COOKIE_NAMES` is exported from `@viu/emporix-sdk-react/ssr`. Not from
`./storage`: that entry carries the `"use client"` banner and has no business in
a `proxy.ts`. `./ssr` is banner-free and the entry that
`packages/next/src/session.ts` already imports from today.

That way the eight cookie names stay single-sourced in `cookie-core.ts`,
instead of `@viu/emporix-sdk-next` laying down a third copy of the literals.

Release sequence: one PR, one release. Changesets publishes in topological
order, so `@viu/emporix-sdk-react` before `@viu/emporix-sdk-next`; the
`workspace:^` peer range is rewritten to the new react version at packing
time.

## Non-Goals

- **No host map, no locale list, no convention.** Policy belongs in the
  storefront.
- **No exported `matcher`.** An imported value is a variable as far as Next is
  concerned and is silently ignored. The package can only document it; it has
  to sit inline in the `proxy.ts`.
- **No cookie deleting.** `undefined` means «leave untouched». Anyone who wants
  to delete calls `response.cookies.delete` themselves.
- **No redirect path.** See above — it does not need the function.
- **No Emporix call, no `getEmporixClient` import.** Ruled out by the Next
  docs.
- **No change to `examples/next-app-router`.** The example is single-site
  CHF/`main`; a proxy there would be demo ceremony. Verification happens against
  a real server with a temporary, uncommitted file (see below).

## Tests

Ten unit tests in `packages/next/tests/proxy.test.ts`, against real
`NextRequest`/`NextResponse` from `next/server`:

| # | Case | Expectation |
|---|---|---|
| 1 | both fields set, no cookies present | two `Set-Cookie`, correct values |
| 2 | header injection | `request.headers.get("cookie")` contains both names after the call |
| 3 | both incoming cookies already match | `response.cookies.getAll()` is empty |
| 4 | only `language` | exactly one `Set-Cookie` |
| 5 | `{}` | no `Set-Cookie`, response is a pass-through |
| 6 | `rewriteTo` as a relative string | `x-middleware-rewrite` is the absolute URL, cookies set nonetheless |
| 7 | `rewriteTo` as an absolute `URL` | ditto |
| 8 | `http://` vs `https://` | `Secure` only on https |
| 9 | `httpOnly` | set on **neither** of the two cookies |
| 10 | incoming cookie has a **different** value | gets overwritten, in the `Set-Cookie` and in the forwarded header |

Test 9 is the most important one — it is the regression brake for the one
security-relevant line. Test 10 pins down the overwrite semantics from the
«Decision» section and is the counterpart to test 3: if the cookie matches,
nothing is written; if it does not, the resolver wins.

Rewrite is checked via `x-middleware-rewrite`, with a source reference
(`next/dist/server/web/spec-extension/response.js:118`) in the test, so that a
Next breakage fails diagnosably instead of mysteriously. `next/experimental/testing/server`
with `getRewrittenUrl` would be the sanctioned alternative, but it is
`unstable_`-named; within `next@^16` the header is stable.

### Verification against a real server

Unit tests do not prove the header forwarding — only that the function builds
the right objects. Whether Next really passes the mutated headers on to the
render is only shown by a running server:

1. temporary `proxy.ts` in `examples/next-app-router` that derives `language`
   from the first path segment,
2. `next build` and `next start`,
3. `curl -sD- http://localhost:3000/de/ -o /dev/null` → expects `Set-Cookie`
   for both names, **without** `Secure` (http),
4. the same call with `-b "emporix.language=de"` → expects **no**
   `Set-Cookie` for `language` (no-op guard),
5. delete the temporary file.

Step 5 is part of the task, not an afterthought: the example gets no
committed change.

## Docs

One section in `packages/next/README.md` with a copy-paste-ready
`proxy.ts`, including an **inline**-written `matcher` together with its
negative lookahead, and the note on why the matcher is not importable.
Plus the `createCookieStorage` prerequisite.

No `docs/nextjs.md` in this cycle — that remains the open follow-up for
`images.remotePatterns` and is a different topic.

## Honest Assessment

This is the follow-up with the weakest benefit of the three open ones. Next
itself advises against Proxy, and for language via a path prefix 16 offers the
better way without a proxy: `app/[locale]/…` plus `await locale()` from
`next/root-params`. The proxy is only mandatory when the discriminator is the
host or when the first visit is meant to guess from `Accept-Language` and persist.

The scope — around 25 lines plus one export in react — makes it defensible,
but not urgent. Anyone who has only one site and one language needs none of
it; `getEmporixClient({ context })` is enough.

## Open Follow-ups After This

1. `docs/nextjs.md` with the `images.remotePatterns` entry for `next/image`.
   Emporix Media documents no transform parameters, so there is no
   custom loader to write; `packages/next/README.md` already mentions
   `remotePatterns`.
2. Share the eight storage-key literals between
   `packages/react/src/storage/cookie-core.ts` and
   `packages/react/src/storage/web-storage.ts`. The duplication survived the
   `cookie-core` extraction — web-storage uses them as
   localStorage/sessionStorage keys, not as cookie names. The `COOKIE_NAMES`
   export from `./ssr` added here makes this task more
   visible, but does not solve it.
3. EUR/CHF divergence in the example: `providers.tsx:24` binds
   `{ currency: "EUR", siteCode: "main", targetLocation: "DE" }`,
   whereas `app/emporix.ts:19` binds `{ siteCode: "main", currency: "CHF" }`.
   Split off as a separate task.
