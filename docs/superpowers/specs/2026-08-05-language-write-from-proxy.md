# May middleware write the language cookie from the path?

**Status:** analysis. Options 1 and 2 shipped, option B still open.
**Date:** 2026-08-05
**Affects:** `packages/next/src/proxy.ts` (`emporixSiteProxy`), `examples/next-server-first/proxy.ts`
**Origin:** found while measuring for the discarded prefetch guard — see [`../plans/2026-08-05-prefetch-guard-proxy.md`](../plans/2026-08-05-prefetch-guard-proxy.md).

## The defect

`emporixSiteProxy` writes `emporix.language` from the first path segment on **every**
request that reaches middleware. A prefetch is such a request. So:

> A prefetchable link to another language switches the visitor's language the moment
> it enters the viewport. Without a click.

The session routes (`/cart`, `/checkout`, `/account/…`) read exactly that cookie.
They then render in a language nobody chose, and it does not heal on its own — only
visiting a page in the intended language resets it.

### Measured, not assumed

Measured on 2026-08-05 against `next start` with a real `<Link prefetch>` in Chrome —
not a curl artefact. The prefetch request to `/en/product/…` from a `/de` page, with
`cookie: emporix.language=de`:

```
Request headers (sent by the browser):
  next-router-prefetch: 1
  rsc: 1
  next-router-segment-prefetch: /_tree

Response:
  set-cookie: emporix.language=en; Max-Age=31536000
  x-nextjs-cache: MISS
```

The language flipped to `en`. The visitor had clicked nothing.

## Why no guard helps

The obvious fix — "write nothing on a prefetch" — is **not implementable** in
middleware. A probe echoing the incoming headers back as a response header shows:

| Header / signal                | Document navigation | fetch/RSC request (prefetch **and** client-side navigation) |
| ------------------------------ | ------------------- | ---------------------------------------------------------- |
| `next-router-prefetch`         | `null`              | `null`                                                     |
| `rsc`                          | `null`              | `null`                                                     |
| `next-router-segment-prefetch` | `null`              | `null`                                                     |
| `_rsc` query parameter         | `false`             | `false`                                                    |
| `sec-purpose`                  | `null`              | `null`                                                     |
| **`sec-fetch-mode`**           | **`navigate`**      | **`cors`**                                                 |
| **`sec-fetch-dest`**           | **`document`**      | **`empty`**                                                |

**Next strips every one of its own router signals before middleware runs** —
including the `_rsc` query parameter, although it sits in the URL. The response
`Vary` still lists `next-router-prefetch`, so Next uses it internally and simply does
not pass it on.

Middleware therefore **cannot** tell a prefetch from a genuine client-side
navigation. A guard on "is an RSC request" would hit both.

What it **can** do: tell a real top-level navigation from everything else.
`sec-fetch-mode` is set by the browser, Next has no reason to remove it, and the
measurement confirms it arrives.

## How it got here

Before PR #230 only `/api/session/language` — the switcher — wrote the cookie. The
gap: a visitor who never clicks the switcher has no cookie, and then `LOCALE_ORDER`
in `examples/shared/src/adapters.ts` applies, which started with `en`. Result: German
catalog, English cart.

\#230 closed that by having the proxy write the cookie from the path. The trade was
"cookie sometimes missing" for "cookie sometimes wrong". Net an improvement — the
common case is now right — but the new failure mode is non-deterministic and
surprising, and that is the more unpleasant kind.

**The defect was latent at the time:** the example had no prefetchable link to the
other language. The switcher points at `/api/session/language`, and the matcher
excludes `api`. It goes live the moment somebody adds `<Link>` — which is exactly
what E2 did.

## Four options

### 1 — Write only on a real document navigation ✅ shipped

Gate on `sec-fetch-mode === "navigate"`.

| Case                              | Behaviour                                         |
| --------------------------------- | ------------------------------------------------- |
| First contact on `/de/x`          | document → writes ✓ (the #230 gap stays closed)   |
| Prefetch of `/en/y`               | not a document → does not write ✓ (defect fixed)  |
| Client-side navigation to `/en/y` | not a document → does not write                   |

The third row is the price, and it is smaller than it looks: the **only** intentional
language change in this app goes through the switcher, which writes its cookie itself
via the route handler. The middleware write only matters for *first contact* — and a
first contact is always a document navigation.

A missing `sec-fetch-mode` (old browsers, curl, bots) counts as a navigation:
fail-open, because the absent header shows up on a bot whose cookie nobody cares
about, and because it keeps the ten existing `proxy.test.ts` cases valid.

### 2 — Sort `LOCALE_ORDER` by the tenant default ✅ shipped

`examples/shared/src/adapters.ts` started with `["en", "en-US", "de", …]`. The `viu`
tenant reports `defaultLanguage: "de"` (measured 2026-08-04), so a cookie-less
request fell back to English against the tenant's own default.

Does **not** fix the prefetch defect — a wrongly set cookie stays wrong. But it is a
defect in its own right in shared code, and it makes the cookie-less state harmless.

### B — Move the session routes under `/[lang]/…` ⏳ open

Then **every** route reads the language from the URL and the cookie is not needed for
language at all. The middleware write disappears, and the whole class of failure with
it.

**Effort:** eight routes plus every internal link, `safeNext`, the login redirect
chain, `swapLanguage`, the e2e specs. **Risk:** large in diff, small in concept.

Note: the CMS analysis argued for this independently — a CMS owns the shell
(navigation, footer, labels) too, and that is per-language and needed on every route.
If a CMS arrives, B is due anyway.

### D — Do nothing, document it ❌ rejected

Rule: "never make a cross-language link prefetchable." Fragile — precisely the kind
of rule nobody remembers in six months, and E2 was the first occasion to break it.

## Still to check

- Does `sec-fetch-mode` behave the same behind a TLS-terminating reverse proxy and on
  Vercel? The measurement was `next start` on localhost. The header is browser-set and
  a proxy has no reason to strip it, but that is not evidence.
- The gate covers `emporix.siteCode` as well. Both keys are in `PUBLIC_KEYS` and both
  are visitor state, so treating them alike is right — though `siteCode` comes from a
  constant in this example rather than from the path, and so is never "wrong".
