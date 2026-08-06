# Session routes under `/[lang]/…` — design

**Status:** approved (2026-08-06)
**Date:** 2026-08-06
**Affects:** `examples/next-server-first` only. No package change.
**Predecessor:** option B in
[`2026-08-05-language-write-from-proxy.md`](./2026-08-05-language-write-from-proxy.md),
open since 2026-08-05 with «effort: eight routes plus every internal link».
**Shape:** one PR with ordered commits, not a stack. The natural split — move the routes,
then delete the cookie, then move the root layout — produces intermediate states that all
work, but each would ship a demo whose README describes the other half. It also avoids the
CI gap that stacked PRs hit twice in this series: `pr-check.yml` only runs against `main`.

## Why now

The option was recorded with one reason and deferred. It now has four, and they arrived
independently of each other — which is a different kind of argument than one reason
repeated:

| # | Reason | Where it came from |
|---|---|---|
| 1 | **The https cookie-precedence edge.** Two writers with different naming rules: `emporixSiteProxy` writes `emporix.language` bare, `emporixSessionHandle` writes `__Host-emporix.language` on https, and `readCookie` prefers the prefixed one. On https a switcher choice therefore wins permanently against the URL. | The original option-B note |
| 2 | **A CMS owns the shell.** Navigation, footer and labels are per language and needed on every route, session routes included. | The original option-B note |
| 3 | **`Set-Cookie` on cacheable catalog HTML.** Measured 2026-08-06: `/de/product/…` answers `x-nextjs-cache: HIT` and `Cache-Control: s-maxage=3600` **and** two `Set-Cookie` fields. A crawler keeps no cookies, so this happens on every crawl, and «Set-Cookie on a 200» is the standard reason a generic CDN declines to cache. | The SEO analysis, S5 |
| 4 | **`<html lang>` is wrong on every German page.** Only the root layout may render `<html>` and it cannot see the `[lang]` segment. #241 shipped a `<div lang={lang}>` wrapper as the honest interim. | The SEO analysis, S3 |

Reasons 3 and 4 are the ones that make this worth doing now: both were paid for with
interim compromises that this change deletes rather than improves.

## Measured foundations

**A dynamic segment may host the root layout.** This is the load-bearing assumption, and it
is a first-class Next 16 concept rather than a trick: `next/dist/build/segment-config/app/collect-root-param-keys.js`
walks the loader tree from the top collecting dynamic-segment params and stops at the first
layout — «If this has a layout module, then we've found the root layout». Those are Next's
*root params*, which is what `rootParams()` exists to read. Route handlers are excluded from
the walk entirely (`if (isAppRouteRouteModule(routeModule)) return []`), so `app/api/**`,
`app/robots.ts`, `app/sitemap.ts` and `app/icon.svg` need no layout.

**The proxy can write nothing.** `site` is optional in `EmporixTokenProxyOptions`
(`packages/next/src/token-proxy.ts:11`), and `proxy.test.ts` already pins that
`emporixSiteProxy(request, {})` «passes the request through untouched» with zero cookies. So
dropping the option is a supported configuration, not an accident.

**`switchLanguage` is already dead.** `app/actions/site.ts` exports a Server Action that
nothing imports — left over from the switcher design that preceded
`/api/session/language`. It is deleted here, but it was dead before.

**The e2e suite is unaffected.** `playwright.config.ts` boots `examples/vite-spa`. Nothing
in `e2e/specs/` touches this example.

## The design

### Route map

`app/[lang]/layout.tsx` becomes **the** root layout. `app/layout.tsx` is deleted and its
contents — the three `next/font/google` families, the three CSS imports, `metadataBase`, the
title template, the default description and the `<Header />` — move up into it. It then
renders `<html lang={lang}>`, and the `<div lang={lang}>` wrapper from #241 goes away.

| | before | after |
|---|---|---|
| catalog | `● /[lang]`, `/[lang]/categories`, `/[lang]/category/[id]/[[...page]]`, `/[lang]/product/[id]/[[...variant]]` | unchanged |
| session | `ƒ /cart`, `/checkout`, `/checkout/done`, `/login`, `/account`, `/account/addresses`, `/account/orders`, `/account/orders/[id]`, `/account/profile`, `/search` | the same ten under `/[lang]/…` |
| debug | `○ /debug` | `● /[lang]/debug`, both languages prerendered |
| entry | `ƒ /`, `ƒ /categories` | **deleted.** The proxy answers `/` |
| switcher API | `ƒ /api/session/language` | **deleted** |
| machine files | `○ /robots.txt`, `/sitemap.xml`, `/icon.svg`, `ƒ /api/emporix/**`, `ƒ /api/session/nav` | unchanged |

Eleven page directories move (ten session routes plus `debug`), two pages and one route
handler are deleted.

### One language source

The `emporix.language` cookie stops existing in this example. That removes, in order of how
much each simplifies:

- **`/api/session/language/route.ts`** — deleted. Its two modes were «write and redirect»
  and «read for the switcher's active marker»; the URL now answers both.
- **`app/actions/site.ts`** — deleted. Dead already.
- **`LanguageSwitcher`** — loses the `fetch` to the read mode, the `cookieActive` state and
  both `useEffect`s that fed it. It stays a client island because it needs `usePathname()`,
  and it **becomes a `<Link>`**: its target is a page now, not a route handler, which
  removes the «the only `<a>` in this app, and it has to stay one» exception documented in
  its own file.
- **`siteContext(lang?)`** — loses its cookie read. `lang` stays **optional** and falls back
  to `DEFAULT_LANGUAGE`; see «How far `lang` is threaded» below.
- **`app/lib/path-language.ts`** and its test — deleted. It existed so the proxy could
  derive the language from the path in order to write the cookie. No cookie, no derivation.
- **`app/lib/swap-language.ts`** — loses the session-route branch, because there is no
  longer a path without a language for the switcher to render on.
- **`proxy.ts`** — passes no `site`, so `emporixSiteProxy` writes nothing and **no
  `Set-Cookie` appears on cacheable catalog HTML**. Token rotation is untouched, and stays
  ungated for the reason its changeset already gives: a visitor who navigates client-side
  for an hour would otherwise never rotate.

### `/` and language negotiation

`/` cannot be a page: without `app/layout.tsx` there is no layout to render it into. The
proxy answers it.

```ts
// app/lib/negotiate-language.ts — pure, no imports, vitest-loadable.
export function negotiateLanguage(
  header: string | null,
  served: readonly string[],
  fallback: string,
): string;
```

Rules, each with a test: q-values decide the order (`en;q=0.8, de;q=0.9` → `de`); a region
subtag matches its primary language (`de-CH` → `de`); `*` and a missing or unparseable
header fall back; a language the tenant does not serve is skipped rather than returned.

The redirect is **307, not 308**. A permanent redirect would be cached by the browser, and
which language `/` prefers is configuration plus a request header — not a fact about the
URL.

`Vary: Accept-Language` belongs on that redirect. It is not cached anyway, so this costs
nothing and stops a shared cache pinning one visitor's negotiation for everybody.

### Server Actions have no `params`

The part most likely to be discovered late, so it is named here. A Server Action receives
`FormData`, not route params, so any action that redirects needs the language handed to it:

| Place | Redirects to | How it gets the language |
|---|---|---|
| `actions/checkout.ts` | `/checkout?error=…`, `/checkout/done?orderId=…` (3 sites) | hidden `lang` field on the checkout form |
| `actions/auth.ts` | `safeNext(next)`, falling back to `"/"` | hidden `lang` field; the fallback becomes `/{lang}` |
| `lib/require-customer.ts` | `/login?next=…` | signature becomes `requireCustomer(lang, next)` |

A hidden form field rather than a `headers()` read of the referer: the referer is optional,
spoofable and absent on the first POST after a redirect. The forms already carry hidden
fields (`productId`), so this follows the file's own pattern.

`safeNext` is unchanged — it validates «own path only», and `/de/account/orders` is one.

### How far `lang` is threaded

Counted while planning, and it changes the shape of this section: `emporixOptions()` and
`siteContext()` are called **23 times** with no argument — across 8 pages and 5 action files
— not the three redirect sites above. Threading a language through all 23 would be a large
mechanical diff for a difference that is mostly invisible, so the rule is:

| Caller | Gets `lang` | Why |
|---|---|---|
| The 8 session pages (`cart`, `checkout`, `account`×5, `search`) | **yes**, from `params` | They render localized content — product names, order items. The language is visible. |
| `submitCheckout` | **yes**, from the hidden field it already needs for its redirect | Its Emporix errors reach the visitor through `describeError`. |
| The remaining actions (`cart.ts`, `account.ts`, `auth.ts`) | no — `DEFAULT_LANGUAGE` | They mutate and redirect; the page that re-renders afterwards supplies its own language. |

`DEFAULT_LANGUAGE` is a constant, not a second source of truth, so «one language source»
still holds for everything a visitor sees. **The wart, named rather than hidden:** an
Emporix error surfaced by a cart or account action can arrive in German on an English page.
It is one constant away from being fixed if it ever shows up, and the alternative was
threading a parameter through 23 sites on the chance that it does.

### What 404s now, deliberately

Unprefixed `/cart`, `/login`, `/account/orders` become 404s. `/cart` is a single segment, so
it matches `/[lang]`, fails `isLanguage`, and 404s through the layout's guard; `/account/orders`
matches no route at all and gets Next's built-in 404.

No legacy-redirect list. A general «prefix anything unprefixed» rule would turn clean 404s
into redirect-then-404 chains, which is worse for a crawler than either, and an allowlist of
old paths is exactly the kind of thing that outlives its reason. These URLs were never
public — the demo runs on localhost and against one tenant.

## Tests

| File | Change |
|---|---|
`tests/negotiate-language.test.ts` | **new** — q-values, region subtags, `*`, missing header, unserved language |
`tests/swap-language.test.ts` | rewritten: the session-route case is gone |
`tests/path-language.test.ts` | **deleted** with its module |
`tests/languages.test.ts`, `seo.test.ts`, `page-segment.test.ts`, `json-ld.test.ts`, `category-index.test.ts`, `safe-next.test.ts`, `strip-html.test.ts` | unchanged |

The acceptance checks that cannot be unit-tested, run against `next start`:

1. `next build` shows four `●` catalog routes, `● /[lang]/debug`, ten `ƒ /[lang]/…` session
   routes, and **no** `/` or `/api/session/language`.
2. `/de/product/…` carries **zero** `Set-Cookie` fields while still answering
   `x-nextjs-cache: HIT`. This is reason 3, and it is the single most important line of the
   verification.
3. `<html lang="de">` on `/de/…` and `<html lang="en">` on `/en/…`, with no `<div lang>`.
4. `curl -H 'Accept-Language: en-GB,en;q=0.9' /` → 307 to `/en`; with `de` → `/de`; with no
   header → `/de`.
5. `/cart` → 404.
6. The language switcher on `/de/cart` navigates to `/en/cart` and the page renders English.
7. Login → `/de/account`, and the `?next=` round trip keeps its prefix. Needs the user's own
   hand on the password field.

## Risk and fallback

The root-layout move is the assumption everything else rests on. It is confirmed from Next's
own source rather than from memory, and the first implementation task is the move plus a
build, so a wrong assumption fails within minutes and before any link rewriting.

**If Next refuses it:** keep `app/layout.tsx` and the `<div lang>` wrapper. Reasons 1, 2 and
3 are still paid off — only `<html lang>` stays as it is. Nothing else in this design depends
on the root layout moving.

A second, smaller risk: with no `app/layout.tsx` there is no root `not-found.tsx` either, so
a path matching no route falls back to Next's unstyled built-in 404. `app/[lang]/not-found.tsx`
covers everything under a valid language, which is every URL the app itself produces.

## Non-goals

- **Making the session routes cacheable.** They read the session; they render per visitor by
  definition. This change is about one language source, not about caching them.
- **The CMS shell.** Reason 2 is why this unblocks it, not something this delivers.
- **Moving `x-default` to `/`.** Now that `/` negotiates it is arguably the language-neutral
  entry, but `alternatesFor` would need a per-page exception for the home alone, and
  pointing `x-default` at the default language is accepted practice. Left as is.
- **Package changes.** `emporixSiteProxy`'s language write and the `isTopLevelNavigation`
  gate stay for other consumers. Worth recording: **this example stops exercising that code
  path**, so `packages/next/tests/proxy.test.ts` and `navigation.test.ts` become its only
  coverage.

## Open points

1. **Does `generateStaticParams` still prerender both languages from the root layout?** It
   sits there today and the two `/de` and `/en` shells are prerendered from it. Nothing in
   Next's root-param handling suggests otherwise, but the build table is the check — task 1.
2. **`/[lang]/debug` becomes `●` instead of `○`**, so the demo's own debug page is now
   prerendered per language. Harmless, and it keeps its `noindex` from the layout added in
   #241 — but the title block on that page claims a render mode, and that claim now has to
   say `STATIC · ISR` rather than what it says today.
