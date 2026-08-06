# Session routes under `/[lang]/…` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the URL the only place `examples/next-server-first` keeps the visitor's
language, so `<html lang>` is right, no `Set-Cookie` lands on cacheable catalog HTML, and the
https cookie-precedence edge stops existing.

**Architecture:** Eleven route directories move under the existing `[lang]` segment; `/` stops
being a page and becomes a negotiated redirect in the proxy; `app/[lang]/layout.tsx` then takes
over as *the* root layout and `app/layout.tsx` is deleted; the internal links get their prefix;
and finally the `emporix.language` cookie and everything that fed it are removed. Seven ordered
tasks in **one PR** — the intermediate states build but do not all navigate, which is called out
where it happens.

**The order is not arbitrary.** Links come after the root layout move because `Header` gains a
required `lang` prop and only a layout under `[lang]` can supply one; the root layout move comes
after `/` because a page at the app root with no root layout renders a fragment rather than
failing. Reordering these breaks the build in ways the plan otherwise promises it will not.

**Tech Stack:** Next 16.2.12 App Router, `@viu/emporix-sdk-next`, vitest, `git mv`.

## Global Constraints

- **Everything written into the repo is English** — comments, JSDoc, commit messages, PR
  body, README prose, test names. See `CLAUDE.md`.
- **Commitlint:** scope from `repo, release, sdk, react, core, customer, product, category,
  cart, checkout, payment, price, media, segment, availability, auth, http, logger, deps,
  docs, examples`. No `next` scope — use `examples`. First word after the scope a lowercase
  verb.
- **No changeset.** Only `examples/next-server-first` changes, and `@viu/emporix-examples-*`
  are under `ignore` in `.changeset/config.json`.
- **No package change.** `emporixSiteProxy`'s language write and `isTopLevelNavigation` stay
  for other consumers.
- **The four `●` catalog routes stay `●`.** A `cookies()` or `headers()` read anywhere in
  their tree turns them `ƒ`.
- **One PR, ordered commits.** Branch `feat/example-session-routes-under-lang`, already
  created, already carrying the spec.
- **Do not merge.** Open the PR and stop.

## Measurements this plan is built on

Spiked on 2026-08-06 against this example, then reverted.

| Question | Measured answer |
|---|---|
| May a dynamic segment host the root layout? | **Yes.** `app/layout.tsx` moved aside, `<html lang={lang}>` added to `app/[lang]/layout.tsx` → build succeeded and `/de` served `<html lang="de">`. Next 16 calls these *root params*; `collect-root-param-keys.js` walks the tree until «we've found the root layout». |
| What happens to a page left outside `[lang]`? | **It does not fail the build.** `/cart` answered `200` with a `<title>` but **no `<html>` and no `<body>`** — 6'381 bytes of fragment against 30'789 for `/de`. There is no safety net: a forgotten route degrades silently. |
| Can the proxy write no cookies at all? | Yes. `site` is optional in `EmporixTokenProxyOptions` (`packages/next/src/token-proxy.ts:11`) and `proxy.test.ts` pins that `emporixSiteProxy(request, {})` passes the request through with zero cookies. |
| How wide is the no-argument `siteContext()` habit? | **23 call sites** across 8 pages and 5 action files. Bounded per the spec's «How far `lang` is threaded» — pages yes, most actions no. |
| Is `switchLanguage` used? | No. `app/actions/site.ts` is dead code today. |
| Is the e2e suite affected? | No. `playwright.config.ts` boots `examples/vite-spa`. |

**Because of measurement 2, Task 4 carries a mechanical guard** — the build alone cannot tell
you that a route was left behind.

---

## File structure

### Moved wholesale (`git mv`, 11 directories)

`app/cart`, `app/checkout` (incl. `done`), `app/login`, `app/account` (incl. `addresses`,
`orders`, `orders/[id]`, `profile`), `app/search`, `app/debug` → under `app/[lang]/`.

Every moved file needs: one more `../` on relative imports, a `params: Promise<{ lang: string }>`
where it did not have one, and its `Sheet meta.route` string reprefixed.

### Created

| File | Responsibility |
|---|---|
| `app/lib/negotiate-language.ts` | `negotiateLanguage` — the only place that reads `Accept-Language`. Pure, no imports. |
| `tests/negotiate-language.test.ts` | q-values, region subtags, `*`, missing header, unserved language. |
| `app/[lang]/not-found.tsx` | The 404 inside a valid language, so it gets the shell. |

### Deleted

| File | Because |
|---|---|
| `app/layout.tsx` | `app/[lang]/layout.tsx` becomes the root layout. |
| `app/page.tsx`, `app/categories/page.tsx` | `/` is answered by the proxy; `/categories` was only a redirect to the prefixed one. |
| `app/api/session/language/route.ts` | The URL answers both of its modes. |
| `app/actions/site.ts` | Dead already. |
| `app/lib/path-language.ts`, `tests/path-language.test.ts` | Existed so the proxy could derive the language to write the cookie. |

### Modified

`app/[lang]/layout.tsx` (becomes root), `proxy.ts`, `app/lib/site-context.ts`,
`app/lib/swap-language.ts` + its test, `app/components/header.tsx`, `session-nav.tsx`,
`language-switcher.tsx`, `app/lib/require-customer.ts`, `app/actions/auth.ts`,
`app/actions/checkout.ts`, `README.md`, and the predecessor spec's status line.

---

### Task 1: `negotiateLanguage`

**Files:**
- Create: `examples/next-server-first/app/lib/negotiate-language.ts`
- Test: `examples/next-server-first/tests/negotiate-language.test.ts`

**Interfaces:**
- Consumes: nothing. No imports at all — `LANGUAGES` and `DEFAULT_LANGUAGE` are passed in so the module stays a pure function of its arguments and the test needs no fixtures.
- Produces: `negotiateLanguage(header: string | null, served: readonly string[], fallback: string): string`. Task 3 calls it from `proxy.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { negotiateLanguage } from "../app/lib/negotiate-language";

const SERVED = ["en", "de"] as const;

describe("negotiateLanguage", () => {
  it("picks the highest-weighted served language", () => {
    expect(negotiateLanguage("en;q=0.8, de;q=0.9", SERVED, "de")).toBe("de");
    expect(negotiateLanguage("de;q=0.2, en;q=0.7", SERVED, "de")).toBe("en");
  });

  it("treats a missing q as 1", () => {
    // `en, de;q=0.9` means English first — the default weight is 1, not 0.
    expect(negotiateLanguage("en, de;q=0.9", SERVED, "de")).toBe("en");
  });

  it("matches a region subtag to its primary language", () => {
    expect(negotiateLanguage("de-CH", SERVED, "en")).toBe("de");
    expect(negotiateLanguage("en-GB,en;q=0.9", SERVED, "de")).toBe("en");
  });

  it("skips languages the tenant does not serve", () => {
    // fr is not served, so the next acceptable one wins rather than the fallback.
    expect(negotiateLanguage("fr;q=1.0, en;q=0.5", SERVED, "de")).toBe("en");
  });

  it("falls back when nothing matches", () => {
    expect(negotiateLanguage("fr, es", SERVED, "de")).toBe("de");
    expect(negotiateLanguage("*", SERVED, "de")).toBe("de");
    expect(negotiateLanguage(null, SERVED, "de")).toBe("de");
    expect(negotiateLanguage("", SERVED, "de")).toBe("de");
  });

  it("survives a malformed header rather than throwing", () => {
    // This value comes off the wire, so it is whatever the client sent.
    expect(negotiateLanguage(";;;q=", SERVED, "de")).toBe("de");
    expect(negotiateLanguage("en;q=notanumber", SERVED, "de")).toBe("en");
  });

  it("is case-insensitive", () => {
    expect(negotiateLanguage("DE-ch", SERVED, "en")).toBe("de");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm -F @viu/emporix-examples-next-server-first test
```

Expected: FAIL — `Cannot find module '../app/lib/negotiate-language'`.

- [ ] **Step 3: Write the module**

```ts
/**
 * Which of the languages we serve this visitor would rather have.
 *
 * Used for exactly one decision: where `/` sends somebody. Every other URL in this
 * app carries its language in the path, which is the point of the whole layout.
 *
 * `served` and `fallback` are arguments rather than imports so this stays a pure
 * function of its inputs — the test needs no fixtures and the module needs no
 * knowledge of the tenant.
 *
 * Deliberately not a full RFC 4647 implementation: no extended language ranges, no
 * `*` weighting, no script or variant subtags. It compares primary subtags, which is
 * what a two-language storefront needs, and it never throws on a malformed header
 * because that header comes off the wire.
 */
export function negotiateLanguage(
  header: string | null,
  served: readonly string[],
  fallback: string,
): string {
  if (header === null || header.trim() === "") return fallback;

  const ranked = header
    .split(",")
    .map((part) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params
        .map((p) => p.trim())
        .find((p) => p.toLowerCase().startsWith("q="));
      // `Number("notanumber")` is NaN, and NaN loses every comparison below — so a
      // broken q behaves like the default weight rather than poisoning the sort.
      const weight = q === undefined ? 1 : Number(q.slice(2));
      return {
        // Primary subtag only: `de-CH` and `DE-ch` both mean `de` here.
        primary: (tag.split("-")[0] ?? "").trim().toLowerCase(),
        weight: Number.isFinite(weight) ? weight : 1,
      };
    })
    .filter((c) => c.primary !== "" && c.primary !== "*" && c.weight > 0)
    // Descending, and stable — so equal weights keep the client's own order.
    .sort((a, b) => b.weight - a.weight);

  for (const candidate of ranked) {
    const hit = served.find((s) => s.toLowerCase() === candidate.primary);
    if (hit !== undefined) return hit;
  }
  return fallback;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm -F @viu/emporix-examples-next-server-first test
```

Expected: PASS, and the eight existing suites stay green.

- [ ] **Step 5: Commit**

```bash
git add examples/next-server-first/app/lib/negotiate-language.ts examples/next-server-first/tests/negotiate-language.test.ts
git commit -m "feat(examples): add accept-language negotiation"
```

---

### Task 2: Move the eleven route directories

**Files:**
- Move: eleven directories from `app/` to `app/[lang]/` (see the list below)
- Modify: every moved `page.tsx` and `layout.tsx` — import depth, `params`, `Sheet meta.route`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: the moved routes, and `emporixOptions(lang?)`. Task 4 moves the root layout above them; Task 5 rewrites the links that point at them.

**After this task the app builds but does not navigate:** every internal link still points at
the old unprefixed path, which now 404s. That is expected and Task 5 fixes it. Do not chase it
here — the tasks in between are what make a `lang` available to the shell that renders those
links.

- [ ] **Step 1: Move the directories**

```bash
cd examples/next-server-first/app
git mv cart checkout login account search debug '[lang]/'
```

`checkout/done`, `account/addresses`, `account/orders`, `account/orders/[id]` and
`account/profile` travel with their parents. `debug` brings the `layout.tsx` added in #241.

Verify the shape:

```bash
find '[lang]' -name 'page.tsx' | sort
```

Expected: eleven entries under `[lang]/` — `[lang]/page.tsx`, `categories`, `category/…`,
`product/…`, plus `cart`, `checkout`, `checkout/done`, `login`, `account`, `account/addresses`,
`account/orders`, `account/orders/[id]`, `account/profile`, `search`, `debug` — fifteen in
total including the four that were already there.

- [ ] **Step 2: Fix the import depth in every moved file**

Each moved file gained one directory level, so every relative import needs one more `../`.
`app/cart/page.tsx` imported `../emporix`; `app/[lang]/cart/page.tsx` needs `../../emporix`.

```bash
cd examples/next-server-first && pnpm typecheck 2>&1 | grep -E "Cannot find module" | head -40
```

Fix each reported path by adding one `../`. Re-run until clean. Do **not** hand-edit blind —
the compiler lists them exactly, and `account/orders/[id]` is three levels deep so its imports
gain a level too.

- [ ] **Step 3: Give every moved page its `lang`**

Each moved page needs the segment param, and the eight that call `emporixOptions()` or
`siteContext()` must pass it. The signature to add where a page had no props:

```tsx
export default async function CartPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<React.JSX.Element> {
  const { lang } = await params;
```

and the call it feeds — `emporixOptions()` becomes `emporixOptions(lang)` in:

| File | Sites |
|---|---|
| `[lang]/cart/page.tsx` | 1 |
| `[lang]/checkout/page.tsx` | 2 (one is `siteContext()` for `targetLocation`) |
| `[lang]/account/page.tsx` | 1 |
| `[lang]/account/addresses/page.tsx` | 1 |
| `[lang]/account/orders/page.tsx` | 1 |
| `[lang]/account/orders/[id]/page.tsx` | 1 |
| `[lang]/account/profile/page.tsx` | 1 |
| `[lang]/search/page.tsx` | 1 (`siteContext()`), and it can drop its `DEFAULT_LANGUAGE` fallback — `lang` is now certain |

Widen the signature here rather than in Task 6, so this task ends green. One line each in
`app/lib/site-context.ts` — the cookie read stays until Task 6, only the parameter arrives:

```ts
export async function emporixOptions(lang?: string): Promise<WithEmporixSessionOptions> {
  return {
    context: await siteContext(lang),
    // …unchanged
```

- [ ] **Step 4: Reprefix the `Sheet meta.route` strings**

Eleven pages declare their own route pattern in the title block, and those strings are now
wrong. `route: "/cart"` → `route: "/[lang]/cart"`, and so on for every moved page. The
comment in `components/sheet.tsx` says `next build` is the test for these — that is exactly
how a stale one gets caught.

**`/debug` also changes render mode.** It was `○` static; under a dynamic segment it becomes
`● /[lang]/debug`, prerendered per language. Its title block claims a mode, so that claim has
to change too — `render: "static"` with `revalidate` absent, since the page exports none.
Same file, one line, and it is the second half of what step 5's route table is checking.

- [ ] **Step 5: Build**

```bash
cd examples/next-server-first && pnpm build 2>&1 | tail -40
```

Expected: green, with the route table showing `ƒ /[lang]/cart`, `ƒ /[lang]/checkout`,
`ƒ /[lang]/login`, `ƒ /[lang]/account…`, `ƒ /[lang]/search` and `● /[lang]/debug` — and the
four catalog routes still `●`. `ƒ /` and `ƒ /categories` are still listed; they go in Task 3.

- [ ] **Step 6: Commit**

```bash
git add -A examples/next-server-first/app
git commit -m "refactor(examples): move the session routes under the lang segment"
```

---

### Task 3: `/` becomes a negotiated redirect

**Files:**
- Modify: `examples/next-server-first/proxy.ts`
- Delete: `examples/next-server-first/app/page.tsx`, `examples/next-server-first/app/categories/page.tsx`

**Interfaces:**
- Consumes: `negotiateLanguage` from Task 1; `LANGUAGES`, `DEFAULT_LANGUAGE` from `app/lib/languages.ts`.
- Produces: `/` answered in the proxy. **Task 4 relies on `app/page.tsx` being gone** — a page at the app root with no root layout renders a fragment, measured. This task is what makes `[lang]` the only place a page lives.

- [ ] **Step 1: Delete the two redirect pages**

```bash
cd examples/next-server-first && git rm app/page.tsx app/categories/page.tsx
```

Both existed only to read the cookie and redirect to the prefixed URL. `/` moves into the
proxy; `/categories` disappears entirely, because the header now links straight at
`/${lang}/categories`.

- [ ] **Step 2: Answer `/` in the proxy**

In `proxy.ts`, before the `emporixTokenProxy` call:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { negotiateLanguage } from "./app/lib/negotiate-language";
import { DEFAULT_LANGUAGE, LANGUAGES } from "./app/lib/languages";
```

```ts
export async function proxy(request: NextRequest) {
  // `/` cannot be a page any more: with no `app/layout.tsx` there is no layout to
  // render it into. It is a redirect, and the proxy is the only place left that can
  // make one.
  //
  // 307, not 308: a permanent redirect would be cached by the browser, and which
  // language `/` prefers is configuration plus a request header — not a fact about
  // the URL.
  if (request.nextUrl.pathname === "/") {
    const lang = negotiateLanguage(
      request.headers.get("accept-language"),
      LANGUAGES,
      DEFAULT_LANGUAGE,
    );
    const to = new URL(`/${lang}`, request.url);
    const redirect = NextResponse.redirect(to, 307);
    // The target depends on a request header, so say so. This response is not
    // cached, but a shared cache in front must not pin one visitor's negotiation
    // for everybody.
    redirect.headers.set("Vary", "Accept-Language");
    return redirect;
  }

  return emporixTokenProxy(request, STORE_OPT);
}
```

Note what the last line no longer passes: **no `site`**. `emporixSiteProxy` therefore writes
nothing, which is the whole point of reason 3.

- [ ] **Step 3: Rewrite the file's doc comment**

The comment above `proxy` currently explains the language-cookie seam at length — the seam
this task removes. Replace it with what the file does now:

```ts
/**
 * Rotates the customer token, and answers `/`.
 *
 * It used to hold the seam between two language sources: the catalog read the
 * language from the URL, the session routes from a cookie, and this proxy wrote that
 * cookie from the path so the two agreed. There is one source now — the URL — so the
 * write is gone and with it the whole class of failure it caused: a `<Link>` prefetch
 * of another language switching the visitor's language, and on https a switcher
 * choice outranking the URL permanently because two writers disagreed about the
 * `__Host-` prefix.
 *
 * What is left is token rotation, which stays ungated for the reason its own
 * changeset gives: a visitor who navigates client-side for an hour would otherwise
 * never rotate.
 *
 * See `docs/superpowers/specs/2026-08-06-session-routes-under-lang-design.md`.
 */
```

- [ ] **Step 4: Build and probe the negotiation**

```bash
cd examples/next-server-first && pnpm build && npx next start -p 3300
```

```bash
curl -s -o /dev/null -D /tmp/r1.txt -w 'no header   %{http_code} -> %{redirect_url}\n' http://localhost:3300/
curl -s -o /dev/null -w 'en-GB       %{http_code} -> %{redirect_url}\n' -H 'Accept-Language: en-GB,en;q=0.9' http://localhost:3300/
curl -s -o /dev/null -w 'de-CH       %{http_code} -> %{redirect_url}\n' -H 'Accept-Language: de-CH,de;q=0.9' http://localhost:3300/
curl -s -o /dev/null -w 'fr only     %{http_code} -> %{redirect_url}\n' -H 'Accept-Language: fr-CH,fr' http://localhost:3300/
grep -i '^vary' /tmp/r1.txt
curl -s -o /dev/null -w 'old /categories %{http_code}\n' http://localhost:3300/categories
```

Expected: `307` every time; targets `/de`, `/en`, `/de`, `/de`; a `Vary` containing
`Accept-Language`; `/categories` now **404**. The build table no longer lists `/` or
`/categories`.

- [ ] **Step 5: The measurement this whole PR is for**

```bash
curl -s -D /tmp/pc.txt -o /dev/null http://localhost:3300/de/product/0f1e2d3c-4b5a
grep -ciE '^set-cookie' /tmp/pc.txt
grep -iE '^(x-nextjs-cache|cache-control)' /tmp/pc.txt
```

Expected: **`0` Set-Cookie fields**, with `Cache-Control: s-maxage=3600, …` and an
`x-nextjs-cache` line still present. Before this PR the same request carried two
`Set-Cookie` fields. If it is not 0, the proxy is still passing `site` somewhere.

- [ ] **Step 6: Commit**

```bash
git add -A examples/next-server-first
git commit -m "feat(examples): answer the root url with a negotiated redirect"
```

---

### Task 4: The root layout moves into `[lang]`

**Files:**
- Modify: `examples/next-server-first/app/[lang]/layout.tsx`
- Delete: `examples/next-server-first/app/layout.tsx`
- Create: `examples/next-server-first/app/[lang]/not-found.tsx`

**Interfaces:**
- Consumes: `SITE_BASE_URL`, `SITE_NAME` from `app/lib/site-url.ts`; `app/page.tsx` and `app/categories/page.tsx` already deleted by Task 3.
- Produces: `<html lang={lang}>`, and a root layout that has a `lang` to pass — which is what Task 5's `Header({ lang })` needs. Render it as `<Header />` here and add the prop in Task 5; both states type-check.

- [ ] **Step 1: Fold `app/layout.tsx` into `app/[lang]/layout.tsx`**

Move across, unchanged: the three `next/font/google` declarations, the three CSS imports, and
the `metadata` export with `metadataBase`, the title template and the description. Then:

```tsx
export default async function LangLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ lang: string }>;
}): Promise<React.JSX.Element> {
  const { lang } = await params;
  // `dynamicParams` defaults to true, so `/fr/…` would otherwise render with a
  // language the tenant does not have — and the value goes straight into
  // `Accept-Language` on every Emporix call the page makes.
  if (!isLanguage(lang)) notFound();

  // THE root layout, and `[lang]` sits above it on purpose. Next 16 calls a dynamic
  // segment above the root layout a *root param* — `collect-root-param-keys.js`
  // walks the tree until «we've found the root layout» — which is what finally makes
  // `<html lang>` tell the truth. Until 2026-08-06 this attribute said `en` on every
  // German page, because the root layout sat at `app/layout.tsx` and could not see
  // this segment. The `<div lang={lang}>` wrapper that stood in for it is gone.
  return (
    <html
      lang={lang}
      className={`${archivo.variable} ${plexSans.variable} ${plexMono.variable}`}
    >
      <body>
        <Header lang={lang} />
        {children}
      </body>
    </html>
  );
}
```

`generateStaticParams` stays exactly as it is.

```bash
cd examples/next-server-first && git rm app/layout.tsx
```

- [ ] **Step 2: Add the 404 inside a language**

```tsx
// app/[lang]/not-found.tsx
import Link from "next/link";

/**
 * The 404 for anything under a valid language — which is every URL this app itself
 * produces. It lives here rather than at `app/not-found.tsx` because there is no
 * root layout there any more; a not-found at the app root would render without the
 * shell, exactly like the fragment measured on 2026-08-06.
 *
 * A path that matches no route at all still gets Next's built-in page. That is
 * accepted: it means somebody typed a URL this app never linked.
 */
export default function LangNotFound(): React.JSX.Element {
  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <p className="eyebrow">404</p>
      <h1 style={{ marginBlock: "var(--s-2) var(--s-5)" }}>No such page</h1>
      <p className="muted">
        <Link href="/" className="u-underline">
          Back to the catalogue
        </Link>
      </p>
    </main>
  );
}
```

`href="/"` on purpose: the proxy negotiates from there, so this one link works in either
language without the component needing to know which.

- [ ] **Step 3: Build and verify the attribute**

```bash
cd examples/next-server-first && pnpm build && npx next start -p 3300
```

```bash
curl -s http://localhost:3300/de | grep -oE '<html[^>]{0,60}' | head -1
curl -s http://localhost:3300/en | grep -oE '<html[^>]{0,60}' | head -1
curl -s http://localhost:3300/de | grep -c '<div lang='
```

Expected: `<html lang="de"` and `<html lang="en"`, and **0** `<div lang=` — the interim
wrapper from #241 is gone.

Also confirm the root layout still prerenders both languages, which was open point 1 of the
spec:

```bash
pnpm build 2>&1 | grep -A3 '● /\[lang\]$'
```

Expected: the `● /[lang]` row followed by its `/en` and `/de` children, exactly as before the
move. `generateStaticParams` on a root layout is what Next calls a root param, and this is the
line that proves it still feeds the prerender.

- [ ] **Step 4: The guard the build cannot give you**

Measured 2026-08-06: a page left outside `[lang]` does **not** fail the build. It answers 200
with no `<html>` and no `<body>`. So check it mechanically, twice — by file layout and by
served bytes:

```bash
cd examples/next-server-first
echo "pages outside [lang] (expect none):"
find app -name 'page.tsx' -not -path 'app/\[lang\]/*'
```

**The backslashes are load-bearing.** In a `find -path` glob, `[lang]` is a character class
matching one of `l`, `a`, `n`, `g` — so the unescaped form silently matches nothing and the
guard reports every page as an offender while looking like it ran. Verified by getting it
wrong once: unescaped printed all 15 pages, escaped printed none.

```bash
echo "every route must ship an <html> element:"
for u in /de /de/categories /de/cart /de/checkout /de/login /de/search /de/debug /de/account; do
  printf '%-18s html=%s\n' "$u" "$(curl -sL "http://localhost:3300$u" | grep -c '<html')"
done
```

Expected: the `find` prints nothing, and every route reports `html=1`. A `0` anywhere means
that route is still outside `[lang]` — or that a redirect chain lost the shell.

If the shell writes that loop into a file to avoid a sandbox refusing an inline `for`, that
is fine; the plan cares about the assertion, not the shell.

- [ ] **Step 5: Commit**

```bash
git add -A examples/next-server-first
git commit -m "feat(examples): make the lang segment the root layout"
```

---

### Task 5: Rewrite every internal link

**Why last:** `Header` gains a required `lang` prop here, and its only caller must be able to
supply one. That caller is the root layout — so Task 4 has to move it under `[lang]` first.
Doing this task third instead would end it with a type error in `app/layout.tsx`, which has no
`lang` to give.

**Files:**
- Modify: `app/components/header.tsx`, `app/components/session-nav.tsx`
- Modify: `app/[lang]/cart/page.tsx`, `app/[lang]/login/page.tsx`, `app/[lang]/checkout/done/page.tsx`, `app/[lang]/account/page.tsx`, `app/[lang]/account/orders/page.tsx`, `app/[lang]/account/orders/[id]/page.tsx`, `app/[lang]/account/addresses/page.tsx`, `app/[lang]/account/profile/page.tsx`
- Modify: `app/lib/require-customer.ts`, `app/actions/auth.ts`, `app/actions/checkout.ts`

**Interfaces:**
- Consumes: the moved routes from Task 2; the root layout from Task 4, which is what passes `lang` into `Header`.
- Produces:
  - `Header({ lang }: { lang: string })` — rendered from `app/[lang]/layout.tsx`.
  - `SessionNav({ lang }: { lang: string })`.
  - `requireCustomer(lang: string, next: string): Promise<string>` — the parameter order is lang-first, matching how every other helper in this app takes it.

- [ ] **Step 1: Give the shell its language**

`header.tsx` becomes a function of `lang`. Six links and one form action change:

```tsx
export function Header({ lang }: { lang: string }): React.JSX.Element {
```

| was | becomes |
|---|---|
| `href="/"` (logo) | `href={`/${lang}`}` |
| `action="/search"` | `action={`/${lang}/search`}` |
| `href="/categories"` | `href={`/${lang}/categories`}` |
| `href="/debug"` | `href={`/${lang}/debug`}` |
| `<SessionNav />` | `<SessionNav lang={lang} />` |

Delete the paragraph in its doc comment that begins «The catalog links stay unprefixed» —
they do not any more, and the hop it describes is gone. Replace it with one sentence: the
shell renders inside `[lang]`, so it always knows the language and never redirects.

`session-nav.tsx` takes `lang` and prefixes its three links:

```tsx
export function SessionNav({ lang }: { lang: string }): React.JSX.Element {
```

`/cart` → `` `/${lang}/cart` ``, `/account` → `` `/${lang}/account` ``, `/login` →
`` `/${lang}/login` ``. The `/api/session/nav` fetch is unchanged — that route stays
unprefixed, because it answers with JSON and has no language.

- [ ] **Step 2: Prefix the links inside the moved pages**

Mechanical, one per line, each already has `lang` from Task 2:

| File | was | becomes |
|---|---|---|
| `[lang]/cart/page.tsx` | `href="/checkout"` | `` href={`/${lang}/checkout`} `` |
| `[lang]/login/page.tsx` | `href="/account"` | `` href={`/${lang}/account`} `` |
| `[lang]/checkout/done/page.tsx` | `href="/debug"` | `` href={`/${lang}/debug`} `` |
| `[lang]/account/page.tsx` | `href="/account/profile"`, `"/account/addresses"`, `"/account/orders"` | prefixed |
| `[lang]/account/orders/page.tsx` | `href="/account"`, `href="/account/orders"` | prefixed |
| `[lang]/account/orders/[id]/page.tsx` | `href="/account/orders"` | prefixed |
| `[lang]/account/addresses/page.tsx` | `href="/account"` | prefixed |
| `[lang]/account/profile/page.tsx` | `href="/account"` | prefixed |

- [ ] **Step 3: `requireCustomer` takes the language**

```ts
export async function requireCustomer(lang: string, next: string): Promise<string> {
  const { customerToken } = await emporixSession(STORE_OPT);
  // The login URL is prefixed now, and so is what it comes back to. `next` arrives
  // from the caller already carrying its own prefix; `safeNext` validates it on the
  // way out.
  if (customerToken === null) {
    redirect(`/${lang}/login?next=${encodeURIComponent(next)}`);
  }
  return customerToken;
}
```

Its five callers are the account pages plus `checkout`. Each passes its own `lang` and a
`next` that now carries the prefix — e.g. `` requireCustomer(lang, `/${lang}/account/orders`) ``.
The compiler finds every site.

- [ ] **Step 4: The two redirecting actions take the language**

`actions/auth.ts` — the fallback, not the `next` itself, which already carries a prefix:

```ts
  // The fallback is the visitor's language home, not `/`: `/` is a proxy redirect
  // now, so returning it would cost a hop after every login that arrived without a
  // `next`.
  const lang = String(formData.get("lang") ?? "");
  const fallback = isLanguage(lang) ? `/${lang}` : `/${DEFAULT_LANGUAGE}`;
  redirect(safeNext(String(formData.get("next") ?? fallback)));
```

with `import { DEFAULT_LANGUAGE, isLanguage } from "../lib/languages";`. The guard matters:
`lang` arrives in a form post, so it is whatever the client sent — the same reason
`safeNext` is applied twice in this file.

`actions/checkout.ts` — three redirects and one `siteContext()`:

```ts
export async function submitCheckout(formData: FormData): Promise<void> {
  // A Server Action gets FormData, not route params, so the language travels as a
  // hidden field. Not the referer: it is optional, spoofable, and absent on the
  // first POST after a redirect.
  const raw = String(formData.get("lang") ?? "");
  const lang = isLanguage(raw) ? raw : DEFAULT_LANGUAGE;
```

then `redirect(`/${lang}/checkout?error=No+cart`)`, the catch's
`` redirect(`/${lang}/checkout?error=${encodeURIComponent(describeError(e))}`) ``, the success
`` redirect(`/${lang}/checkout/done?orderId=…`) ``, and `siteContext()` → `siteContext(lang)`.

- [ ] **Step 5: Feed the hidden fields**

`[lang]/login/page.tsx` and `[lang]/checkout/page.tsx` each render a form that posts to one of
those actions. Add to each:

```tsx
<input type="hidden" name="lang" value={lang} />
```

next to the existing hidden inputs. `login/page.tsx` already renders a hidden `next`, so this
sits beside it.

- [ ] **Step 6: Build, then walk the app**

```bash
cd examples/next-server-first && pnpm build && npx next start -p 3300
```

```bash
curl -s -o /dev/null -w 'de/cart     %{http_code}\n' http://localhost:3300/de/cart
curl -s -o /dev/null -w 'de/login    %{http_code}\n' http://localhost:3300/de/login
curl -s -o /dev/null -w 'de/search   %{http_code}\n' http://localhost:3300/de/search
curl -s -o /dev/null -w 'de/debug    %{http_code}\n' http://localhost:3300/de/debug
curl -s -o /dev/null -w 'de/account  %{http_code}\n' http://localhost:3300/de/account
curl -s -o /dev/null -w 'old /cart   %{http_code}\n' http://localhost:3300/cart
curl -s http://localhost:3300/de | grep -oE 'href="/de/(search|categories|debug|cart|login)[^"]*"' | sort -u
```

Expected: the five prefixed routes answer 200 (`/de/account` 307s to `/de/login`, so 307 is
correct there); `/cart` answers **404**; and the header's own links all carry `/de`. If a
link still shows up unprefixed in that last line, it was missed in step 1 or 2.

- [ ] **Step 7: Commit**

```bash
git add -A examples/next-server-first/app
git commit -m "refactor(examples): prefix every internal link with the language"
```

---

### Task 6: Delete the language cookie

**Files:**
- Delete: `app/api/session/language/route.ts`, `app/actions/site.ts`, `app/lib/path-language.ts`, `tests/path-language.test.ts`
- Modify: `app/lib/site-context.ts`, `app/lib/swap-language.ts`, `tests/swap-language.test.ts`, `app/components/language-switcher.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `siteContext(lang?: string)` — unchanged signature, but the no-argument path now falls back to `DEFAULT_LANGUAGE` instead of reading a cookie.
  - `emporixOptions(lang?: string)` — new optional parameter, forwarded to `siteContext`.
  - `swapLanguage(pathname: string, to: string): string` — unchanged signature, one branch fewer.

- [ ] **Step 1: Delete the four files**

```bash
cd examples/next-server-first
git rm app/api/session/language/route.ts app/actions/site.ts app/lib/path-language.ts tests/path-language.test.ts
```

`/api/session/language` had two modes and the URL answers both. `actions/site.ts` was dead
before this PR. `path-language.ts` existed so the proxy could derive the language in order to
write the cookie — no cookie, no derivation.

- [ ] **Step 2: Take the cookie out of `site-context.ts`**

Replace the body of `siteContext` and widen `emporixOptions`:

```ts
/**
 * The Emporix request context for this request.
 *
 * `lang` comes from the URL — `params.lang` — and every page has it, because every
 * page lives under `[lang]`. It used to be readable from a cookie as well, and that
 * second source is what this file's history is mostly about: two writers with
 * different naming rules, a `<Link>` prefetch able to change it, and an https edge
 * where a switcher choice outranked the URL for good.
 *
 * The parameter stays **optional** and falls back to `DEFAULT_LANGUAGE` — a constant,
 * not a second source of truth. Counted 2026-08-06: 23 call sites asked for the
 * context with no language, most of them Server Actions that mutate and redirect
 * rather than render. Threading a parameter through all 23 would be a large
 * mechanical diff for a difference nobody sees; the pages that *do* render localized
 * content all pass it. The wart that leaves, named rather than hidden: an Emporix
 * error surfaced by a cart or account action can arrive in the default language on a
 * page in the other one.
 */
export async function siteContext(lang?: string): Promise<{
  siteCode: string;
  currency: string;
  targetLocation: string;
  language: string;
}> {
  if (lang !== undefined && !isLanguage(lang)) notFound();
  return { ...DEFAULTS, language: lang ?? DEFAULT_LANGUAGE };
}

/** The same thing for the session calls. */
export async function emporixOptions(lang?: string): Promise<WithEmporixSessionOptions> {
  return {
    context: await siteContext(lang),
    timeouts: TIMEOUTS,
    ...(SESSION_STORE !== undefined ? { store: SESSION_STORE } : {}),
  };
}
```

The `emporixSessionHandle` and `STORAGE_KEYS` imports go with it — the compiler will say so.
Keep the `notFound()` guard: it is the one from #240 that stops an unvalidated segment
reaching `Accept-Language`, and it is still the funnel every catalog page passes through.

Note the return type tightened: `language` is no longer optional, because there is now always
one.

- [ ] **Step 3: Simplify `swapLanguage`**

```ts
/**
 * The path to land on after switching the language.
 *
 * Every route carries its language now, so this is one substitution. The third case
 * this function used to have — «a path with no language is a session route, leave it
 * alone» — described a shape that no longer exists.
 *
 * Pure and free of server imports so vitest can load it.
 */
export function swapLanguage(pathname: string, to: string): string {
  const parts = pathname.split("/");
  if (isLanguage(parts[1] ?? "")) {
    parts[1] = to;
    return parts.join("/");
  }
  // `/` and anything unprefixed: the language home is the honest answer, and it is
  // what the switcher renders on a 404 page.
  return `/${to}`;
}
```

- [ ] **Step 4: Rewrite the `swapLanguage` test**

Replace `tests/swap-language.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { swapLanguage } from "../app/lib/swap-language";

describe("swapLanguage", () => {
  it("swaps the language segment", () => {
    expect(swapLanguage("/de/category/abc", "en")).toBe("/en/category/abc");
    expect(swapLanguage("/en/product/xyz", "de")).toBe("/de/product/xyz");
    expect(swapLanguage("/de", "en")).toBe("/en");
  });

  it("swaps it on a session route too", () => {
    // The case this function used to have to leave alone. Since the session routes
    // moved under `/[lang]/…` they are ordinary prefixed paths.
    expect(swapLanguage("/de/cart", "en")).toBe("/en/cart");
    expect(swapLanguage("/de/account/orders/42", "en")).toBe("/en/account/orders/42");
  });

  it("sends an unprefixed path to the language home", () => {
    // Only reachable from a 404, where the switcher still renders.
    expect(swapLanguage("/", "en")).toBe("/en");
    expect(swapLanguage("", "de")).toBe("/de");
    expect(swapLanguage("/fr/category/abc", "en")).toBe("/en");
  });
});
```

- [ ] **Step 5: The switcher becomes a `<Link>`**

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { LANGUAGES, isLanguage } from "../lib/languages";
import { swapLanguage } from "../lib/swap-language";

/**
 * Two links, and that is all it is now.
 *
 * It used to have three jobs beyond this: write a cookie through
 * `/api/session/language`, read that cookie back to know which chip to box, and be
 * an `<a>` rather than a `<Link>` because its target was a route handler. All three
 * went away with the cookie — the URL carries the language, so the active chip comes
 * from `usePathname()` and the target is a page.
 *
 * Still a client island, and only for `usePathname()`: a Server Component would need
 * `headers()` to learn the current path, and that would make every route dynamic —
 * which is the thing this whole demo is arranged to avoid.
 *
 * `useSearchParams()` is deliberately avoided for the same reason: it would deopt the
 * statically rendered catalog pages. The query is read from `window.location` in an
 * effect, which never runs during prerender.
 */
export function LanguageSwitcher(): React.JSX.Element {
  const pathname = usePathname();
  const segment = pathname.split("/")[1] ?? "";
  const active = isLanguage(segment) ? segment : null;

  const [query, setQuery] = useState("");
  useEffect(() => setQuery(window.location.search), [pathname]);

  return (
    <span className="cluster" style={{ gap: "var(--s-2)" }} aria-label="Language">
      {LANGUAGES.map((l) => (
        <Link
          key={l}
          href={swapLanguage(pathname, l) + query}
          className={l === active ? "tag tag--accent" : "tag"}
          hrefLang={l}
          {...(l === active ? { "aria-current": "true" as const } : {})}
        >
          {l}
        </Link>
      ))}
    </span>
  );
}
```

The `header.tsx` doc comment claims «The **only** `<a>` in this app, and it has to stay one»
about this component — delete that claim from the switcher's own comment and from the header's
prefetch section. There is no `<a>` exception left.

- [ ] **Step 6: Build, test, and verify the cookie is gone**

```bash
pnpm -F @viu/emporix-examples-next-server-first test
pnpm -F @viu/emporix-examples-next-server-first typecheck
cd examples/next-server-first && pnpm build && npx next start -p 3300
```

```bash
curl -s -D /tmp/c1.txt -o /dev/null http://localhost:3300/de
echo "set-cookie on /de:        $(grep -ci '^set-cookie' /tmp/c1.txt)"
curl -s -D /tmp/c2.txt -o /dev/null http://localhost:3300/de/cart
echo "set-cookie on /de/cart:   $(grep -ci '^set-cookie' /tmp/c2.txt)"
curl -s -o /dev/null -w 'api/session/language: %{http_code}\n' http://localhost:3300/api/session/language
curl -s http://localhost:3300/de | grep -oE 'href="/(de|en)"[^>]*hrefLang="[a-z]{2}"' | head -2
```

Expected: `0` on `/de`; `/de/cart` may still carry session cookies, which is correct — those
are the session, not the language; `/api/session/language` **404**; and the switcher's two
links point at `/de` and `/en` rather than at a route handler.

Tests: the `swap-language` suite is rewritten, `path-language` is gone, so the file count goes
from nine to eight and the total drops by the four `path-language` cases while gaining the
three rewritten `swap-language` ones.

- [ ] **Step 7: Commit**

```bash
git add -A examples/next-server-first
git commit -m "refactor(examples): delete the language cookie"
```

---

### Task 7: Docs, full verification, PR

**Files:**
- Modify: `examples/next-server-first/README.md`
- Modify: `docs/superpowers/specs/2026-08-05-language-write-from-proxy.md`

- [ ] **Step 1: Mark option B shipped in the predecessor spec**

Its header says «Options 1 and 2 shipped, option B still open», and the option-B section is
headed «⏳ open». Change the header to «Options 1 and 2 shipped; option B shipped 2026-08-06»,
change the section heading to «✅ shipped», and add one line under it pointing at
`2026-08-06-session-routes-under-lang-design.md`. Leave the reasoning as it stands — it was
right, and a spec that records why something was deferred is worth more than one edited to
look prescient.

Note in the same edit that option 1 — the `sec-fetch-mode` gate — is now **unexercised by
this example**, so `packages/next/tests/proxy.test.ts` and `navigation.test.ts` are its only
coverage. The gate stays in the package for other consumers.

- [ ] **Step 2: Rewrite the two README sections this PR invalidates**

«The seam this leaves, and who holds it» and «The language switch, and why the context stopped
being a constant» both describe machinery that no longer exists. Replace them with one
section:

```markdown
### One language, and it is in the URL

Every route lives under `/[lang]/…` — the catalog and the session routes alike — and
`app/[lang]/layout.tsx` is **the** root layout, so `<html lang>` finally says what the page
is written in. Next 16 calls a dynamic segment above the root layout a *root param*; it is
a supported shape, not a trick.

There used to be a second source. The catalog read the language from the URL because a
`cookies()` read makes a route dynamic for good; the session routes read a cookie because
they render per visitor anyway. Holding those two in agreement cost:

- a proxy that wrote the cookie from the path, which a `<Link>` prefetch could trigger —
  so a link to another language switched the visitor's language on scroll, with no click;
- a `sec-fetch-mode` gate in `@viu/emporix-sdk-next` to stop that;
- an https edge where two writers disagreed about the `__Host-` prefix, and a switcher
  choice therefore outranked the URL permanently;
- a `<div lang={lang}>` wrapper, because the root layout could not see the segment;
- two `Set-Cookie` fields on cacheable catalog HTML — measured, on every crawl, since a
  crawler keeps no cookies.

All five are gone. `/de/product/…` now answers with **zero** `Set-Cookie` fields while still
reporting `x-nextjs-cache: HIT`.

`/` is not a page any more — without `app/layout.tsx` there is no layout to render one into.
The proxy answers it with a **307** to the language the visitor asked for, negotiated from
`Accept-Language` by `lib/negotiate-language.ts`; `Vary: Accept-Language` says so. A 307
rather than a 308 because which language `/` prefers is configuration plus a request header,
not a fact about the URL.

Unprefixed `/cart`, `/login` and `/account/…` are 404s now. No legacy-redirect list: a
general «prefix anything unprefixed» rule would turn clean 404s into redirect-then-404
chains, and an allowlist is exactly the kind of thing that outlives its reason.

**The one compromise, named.** `siteContext(lang?)` still takes an optional language and
falls back to `DEFAULT_LANGUAGE`, because 23 call sites asked for the context without one and
most are Server Actions that mutate and redirect rather than render. Every page that renders
localized content passes its `lang`. What that leaves: an Emporix error surfaced by a cart or
account action can arrive in the default language on a page in the other one.
```

Then sweep the rest of the README for stale paths — `/cart`, `/checkout`, `/account/…` and
`/debug` appear throughout the prose and are now prefixed:

```bash
grep -nE '`/(cart|checkout|login|account|search|debug|categories)' examples/next-server-first/README.md
```

Fix each hit. The two rewritten sections above are the substance; these are the detail that
makes the file honest.

- [ ] **Step 3: Full verification**

```bash
pnpm -F @viu/emporix-examples-next-server-first test
pnpm typecheck
cd examples/next-server-first && pnpm build 2>&1 | tail -40
```

Expected: all suites green; repo-wide typecheck clean; the route table shows

- `● /[lang]`, `● /[lang]/categories`, `● /[lang]/category/[id]/[[...page]]`,
  `● /[lang]/product/[id]/[[...variant]]`, `● /[lang]/debug`
- `ƒ /[lang]/cart`, `/checkout`, `/checkout/done`, `/login`, `/account`, `/account/addresses`,
  `/account/orders`, `/account/orders/[id]`, `/account/profile`, `/search`
- `○ /robots.txt`, `○ /sitemap.xml`, `○ /icon.svg`, `ƒ /api/emporix/…`, `ƒ /api/session/nav`
- **no `/`, no `/categories`, no `/api/session/language`**

- [ ] **Step 4: The seven acceptance checks from the spec**

Run them in order; the second one is the reason this PR exists.

```bash
npx next start -p 3300
```

```bash
# 2 — zero Set-Cookie on cacheable catalog HTML, still cached
curl -s -D /tmp/a2.txt -o /dev/null http://localhost:3300/de/product/0f1e2d3c-4b5a
grep -ciE '^set-cookie' /tmp/a2.txt; grep -iE '^(x-nextjs-cache|cache-control)' /tmp/a2.txt

# 3 — the attribute
curl -s http://localhost:3300/de | grep -oE '<html[^>]{0,40}' | head -1
curl -s http://localhost:3300/en | grep -oE '<html[^>]{0,40}' | head -1
curl -s http://localhost:3300/de | grep -c '<div lang='

# 4 — negotiation
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -H 'Accept-Language: en-GB,en;q=0.9' http://localhost:3300/
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' -H 'Accept-Language: de' http://localhost:3300/
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://localhost:3300/

# 5 — the old paths
curl -s -o /dev/null -w 'cart %{http_code}\n' http://localhost:3300/cart

# 6 — the switcher target
curl -s http://localhost:3300/de/cart | grep -oE 'href="/en/cart"'
```

Expected: `0` and a `Cache-Control: s-maxage=…`; `<html lang="de"`, `<html lang="en"`, `0`
wrappers; `307 → /en`, `307 → /de`, `307 → /de`; `404`; and the switcher on the German cart
pointing at `/en/cart`.

Check 1 is Step 3's route table. **Check 7 needs the user's own hand on the password field** —
ask them to log in on `/de/login`, confirm they land on `/de/account`, and confirm that
visiting `/de/account/orders` while logged out round-trips through `/de/login?next=…` back to
the prefixed orders page. Report it as verified only if they actually did it.

- [ ] **Step 5: Commit, push, open the PR**

```bash
git add -A
git commit -m "docs(examples): document the single language source"
git push origin feat/example-session-routes-under-lang
```

Push over SSH — the `gh` token works for API calls but is rejected for git. Open against
`main`. Body: the four reasons with the two that were paid for by interim compromises called
out; the before/after `Set-Cookie` count; the `<html lang>` before/after; the negotiation
table; the deletion inventory; the named `siteContext` compromise; and the fragment
measurement with the guard it motivated. **Do not merge.**

---

## What this deliberately does not do

- **Make the session routes cacheable.** They read the session. Moving them changed their URL,
  not their nature.
- **Deliver the CMS shell.** This unblocks it — a per-language shell now has a per-language
  route for every page — but ships none of it.
- **Move `x-default` to `/`.** Now that `/` negotiates it is arguably the language-neutral
  entry, but `alternatesFor` would need a per-page exception for the home alone.
- **Touch `@viu/emporix-sdk-next`.** `emporixSiteProxy`'s language write and the
  `isTopLevelNavigation` gate stay for other consumers; this example simply stops using them.
- **Add a root `not-found.tsx`.** There is no root layout to render it in. A path matching no
  route at all gets Next's built-in page, which means somebody typed a URL this app never
  linked.
