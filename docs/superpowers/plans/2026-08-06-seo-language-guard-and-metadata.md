# SEO: language guard and page metadata — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `examples/next-server-first` answering 500 to `/robots.txt` and every other
dotted URL, and give its four catalog routes real per-page metadata — title, description,
canonical, hreflang — without losing a single `●` in the route table.

**Architecture:** Two PRs on one example, no package change. PR 1 puts the language check
in front of every Emporix call instead of behind it, and adds the three metadata routes a
crawler asks for first. PR 2 adds `generateMetadata` to the four catalog routes plus a
`metadataBase`, a title template and a canonical/hreflang builder — all of it pure logic in
two small modules so vitest can hold it, with the page-level wiring verified against a
production build.

**Tech Stack:** Next 16.2.12 App Router, `@viu/emporix-sdk-next`, `@viu/emporix-examples-shared`,
vitest, `next/font/google`.

## Global Constraints

- **Everything written into the repo is English** — comments, JSDoc, commit messages, PR
  bodies, README prose, test names. See `CLAUDE.md`.
- **Commitlint:** scope must be one of `repo, release, sdk, react, core, customer, product,
  category, cart, checkout, payment, price, media, segment, availability, auth, http,
  logger, deps, docs, examples`. There is **no `next` scope** — use `examples`. First word
  after the scope is a lowercase verb.
- **No changeset.** Both PRs touch only `examples/next-server-first`, and
  `@viu/emporix-examples-*` are listed under `ignore` in `.changeset/config.json`.
- **The route table must not regress.** After every task,
  `/[lang]`, `/[lang]/categories`, `/[lang]/category/[id]/[[...page]]` and
  `/[lang]/product/[id]/[[...variant]]` stay `●` in `next build`. A `cookies()` or
  `headers()` read anywhere in their tree turns them `ƒ` and undoes the work of PR #230.
- **Env files are edited by hand, not by the implementer.** Task 2.1 needs a new variable
  in `.env.example` and `.env.local`; ask the repo owner to add the line.
- **Do not merge either PR.** Open it and stop.

## Measurements this plan is built on

All against `next start` on a production build of `examples/next-server-first`, `viu`
tenant, 2026-08-06. Two of them killed a design that looked obviously right.

| Question | Measured answer |
|---|---|
| Why does `/robots.txt` answer 500? | `/[lang]` matches it. `isLanguage` sits in `[lang]/layout.tsx`, but React renders layout and page concurrently, so `[lang]/page.tsx` has already sent `Accept-Language: robots.txt` to Emporix → `400 Language header validation failed` → the throw beats `notFound()`. `/xx` answers 404 because `xx` is a *syntactically valid* language tag, so Emporix returns 200 and the layout's guard gets its turn. |
| Does `export const dynamicParams = false` fix it? | It fixes the 500 (`/robots.txt`, `/zz.txt`, `/ww` → 404) **and cascades to the child segments**: `/de/product/<valid-id>` → 404, `/de/category/<id>/5` → 404. It destroys on-demand ISR. **Disqualified.** |
| Does `app/robots.ts` beat the `/[lang]` segment? | Yes — `/robots.txt` → `200 text/plain`, `/sitemap.xml` → `200 application/xml`. But `/favicon.ico` and `/zz.txt` still 500, so a metadata route only fixes the URL it defines. **Both halves of PR 1 are necessary.** |
| Does a second `products.get` in `generateMetadata` cost a second Emporix call? | **No.** Counted at the socket with a `diagnostics_channel` probe on `undici:request:create`: a cold product page is 4 upstream calls with and without `generateMetadata`, and `GET /product/viu/products/<id>` appears exactly once. Next's request memoization folds them. **No memoization layer needed.** |
| What does a bogus URL cost today? | `/ww` → 404 in 410 ms with a full home-page render including Emporix calls, then `x-nextjs-cache: HIT` in 2 ms with `s-maxage=3600, stale-while-revalidate=31532400`. Every junk URL buys a persistent ISR entry. |
| Is a `<div lang>` wrapper layout-safe? | Yes. `global.css` styles `html` and `body` only — no `body > *` rule, no flex or grid on `body`, and `.container` is max-width plus margin. |

### The call probe, for reuse

Both PRs' acceptance steps count Emporix calls with this. It needs no source edit:

```js
// /tmp/call-probe.cjs — logs method + host + path only, never headers.
const dc = require("node:diagnostics_channel");
const fs = require("node:fs");
const out = process.env.PROBE_OUT || "/tmp/emporix-calls.log";
dc.subscribe("undici:request:create", (evt) => {
  try {
    const r = evt.request;
    fs.appendFileSync(out, `${r.method} ${r.origin || ""}${String(r.path || "").split("?")[0]}\n`);
  } catch {}
});
```

```bash
rm -f /tmp/emporix-calls.log
NODE_OPTIONS="--require /tmp/call-probe.cjs" PROBE_OUT=/tmp/emporix-calls.log npx next start -p 3300
```

---

## File structure

### PR 1 — `fix/example-language-guard`

| File | Responsibility |
|---|---|
| `app/lib/site-context.ts` (modify) | Gains the guard. It is the one funnel every `/[lang]/…` page goes through before it touches Emporix. |
| `tests/languages.test.ts` (modify) | Pins the exact inputs that produced the bug: `robots.txt`, `de.txt`, `favicon.ico`. |
| `app/lib/site-url.ts` (create) | `SITE_BASE_URL` and `SITE_NAME`. Here rather than in PR 2 because both `robots.txt` and `sitemap.xml` must carry **absolute** URLs — the sitemaps protocol requires it, and relying on Next to resolve a relative one against `metadataBase` is undocumented. PR 2 reuses the module for `metadataBase`. |
| `app/robots.ts` (create) | `/robots.txt`. Allows the catalog, disallows the session and search routes. |
| `app/sitemap.ts` (create) | `/sitemap.xml`. Entry URLs plus every category, both languages, out of the already-cached tree. Products are PR 4. |
| `app/icon.svg` (create) | `/icon.svg` — and it is what stops `/favicon.ico` being asked for at all. |
| `proxy.ts` (modify) | Excludes `sitemap.xml` and `icon.svg` from the matcher, next to the `robots.txt` that is already there. |
| `README.md` (modify) | A short «What a crawler gets» section. |

### PR 2 — `feat/example-seo-metadata`

| File | Responsibility |
|---|---|
| `app/lib/seo.ts` (create) | `alternatesFor(lang, suffix)` → `{ canonical, languages }`. Pure, vitest-testable, and the only place that knows the URL shape. |
| `tests/seo.test.ts` (create) | Covers the canonical shape, both languages, `x-default`, and the page-1-has-no-segment rule. |
| `app/layout.tsx` (modify) | `metadataBase`, title template, default description. |
| `app/[lang]/layout.tsx` (modify) | `<div lang={lang}>` around the subtree, because only the root layout may render `<html>`. |
| `app/[lang]/page.tsx` (modify) | `generateMetadata`. |
| `app/[lang]/categories/page.tsx` (modify) | `generateMetadata`. |
| `app/[lang]/product/[id]/[[...variant]]/page.tsx` (modify) | `generateMetadata`; canonical points at the parent product, which neutralises the bogus-variant duplicates. |
| `app/[lang]/category/[id]/[[...page]]/page.tsx` (modify) | `generateMetadata` with the page number; canonical self-references from page 2 on. |
| `app/search/page.tsx`, `app/cart/page.tsx`, `app/checkout/page.tsx`, `app/checkout/done/page.tsx`, `app/login/page.tsx`, `app/account/**/page.tsx`, `app/debug/page.tsx` (modify) | `robots: { index: false, follow: true }`. |
| `README.md` (modify) | The SEO section, including what is deliberately not done. |

### Two decisions worth their own paragraph

**`<html lang>` stays `en`, and a `<div lang={lang}>` carries the truth.** Only the root
layout may render `<html>`, and it cannot see `params.lang` of the segment below it. The
two ways to fix that properly are multiple root layouts via route groups — which makes
every navigation between the catalog and a session route a full document load — or moving
the session routes under `/[lang]/…`, which is option B in
`docs/superpowers/specs/2026-08-05-language-write-from-proxy.md` and a much bigger change.
`lang` is valid on any element and the nearest ancestor wins, so a wrapper is correct for
assistive technology and for the crawlers that read the attribute at all. The shell around
it really is English UI text, so the result is arguably more accurate than either
alternative. Record it as a compromise, do not hide it.

**A product canonical ignores the variant segment.** `/de/product/x/anything` renders 200
today, and pointing each of those at itself would bless the duplicate. Canonicalising every
variant to `/de/product/x` costs one line, needs no extra Emporix call, and is the right
answer for near-identical variant pages anyway. It does not make the junk URLs disappear —
that is PR 3 — it stops them competing.

---

# PR 1 — Stop the 500s

### Task 1.1: The language guard, in front of the Emporix call

**Files:**
- Modify: `examples/next-server-first/app/lib/site-context.ts:47-72`
- Test: `examples/next-server-first/tests/languages.test.ts`

**Interfaces:**
- Consumes: `isLanguage(value: string): value is Language` from `app/lib/languages.ts`, already exported and already tested.
- Produces: `siteContext(lang?: string)` keeps its signature. New behaviour: a non-empty `lang` that is not a known language throws Next's not-found signal instead of reaching Emporix.

- [ ] **Step 1: Write the failing test**

The guard itself lives in a module vitest cannot load — `site-context.ts` pulls in
`@viu/emporix-sdk-next/session`, whose server-only guard throws outside the `react-server`
condition. What *is* testable is the predicate the guard uses, and pinning the three inputs
that actually caused the outage is worth more than a mock of `notFound()`.

Append to `examples/next-server-first/tests/languages.test.ts`:

```ts
  it("rejects the path segments that made /[lang] answer 500", () => {
    // Measured 2026-08-06: `/robots.txt` matched `/[lang]`, and `Accept-Language:
    // robots.txt` made Emporix answer `400 Language header validation failed`. The
    // throw beat the layout's notFound() and the route answered 500.
    expect(isLanguage("robots.txt")).toBe(false);
    expect(isLanguage("sitemap.xml")).toBe(false);
    expect(isLanguage("favicon.ico")).toBe(false);
    expect(isLanguage("de.txt")).toBe(false);
    // And the near miss: `xx` is a syntactically valid language tag, so Emporix
    // answered 200 and the route 404'd. It must still be rejected here.
    expect(isLanguage("xx")).toBe(false);
  });
```

- [ ] **Step 2: Run the test to verify it passes already**

```bash
pnpm -F @viu/emporix-examples-next-server-first test
```

Expected: PASS. `isLanguage` is already correct — the bug was never in the predicate, it
was in *where* it is called. This test is a regression pin, not a red-green cycle. The red
step for this task is the acceptance probe in Step 5, which fails on the current code.

- [ ] **Step 3: Add the guard**

In `examples/next-server-first/app/lib/site-context.ts`, add the import and the guard.
Replace the first line of the function body:

```ts
import { notFound } from "next/navigation";
```

```ts
export async function siteContext(lang?: string): Promise<{
  siteCode: string;
  currency: string;
  targetLocation: string;
  language?: string;
}> {
  if (lang !== undefined) {
    // BEFORE any Emporix call, and that is the whole point.
    //
    // `[lang]/layout.tsx` has the same check, and it is not enough: React renders
    // layout and page concurrently, so the page's `products.get` is already in
    // flight when the layout's `notFound()` runs. Measured 2026-08-06 —
    // `/robots.txt` matches `/[lang]`, sent `Accept-Language: robots.txt`, Emporix
    // answered `400 Language header validation failed`, and the throw beat the
    // notFound(): HTTP 500 instead of 404, plus a billed request, plus a cached
    // ISR entry for the junk URL.
    //
    // Here instead of in each page because every route under `/[lang]/…` calls
    // this before it does anything, so one check covers all four. `dynamicParams
    // = false` on the layout was the other candidate and is disqualified: it
    // fixes the 500 and 404s every product and category page with it, because it
    // cascades to the child segments.
    if (!isLanguage(lang)) notFound();
    return { ...DEFAULTS, language: lang };
  }
  const handle = await emporixSessionHandle({ readOnly: true, ...STORE_OPT });
  // … unchanged from here
```

Add `isLanguage` to the existing import from `./languages`:

```ts
import { DEFAULT_LANGUAGE, isLanguage } from "./languages";
```

- [ ] **Step 4: Typecheck**

```bash
pnpm -F @viu/emporix-examples-next-server-first typecheck
```

Expected: clean.

- [ ] **Step 5: Acceptance — build, serve, probe**

```bash
cd examples/next-server-first && pnpm build && npx next start -p 3300
```

In a second shell:

```bash
curl -s -o /dev/null -w 'zz.txt      %{http_code}\n' http://localhost:3300/zz.txt
curl -s -o /dev/null -w 'robots.txt  %{http_code}\n' http://localhost:3300/robots.txt
curl -s -o /dev/null -w 'favicon.ico %{http_code}\n' http://localhost:3300/favicon.ico
curl -s -o /dev/null -w 'de          %{http_code}\n' http://localhost:3300/de
curl -s -o /dev/null -w 'de/cat/2c3f70c7-918b-5b2b-95ba-fc378011c170 %{http_code}\n' http://localhost:3300/de/category/2c3f70c7-918b-5b2b-95ba-fc378011c170
```

Expected: the first three `404` (they were `500`), the last two `200`. The `next build`
route table still shows four `●` catalog routes.

- [ ] **Step 6: Verify the guard also cut the wasted Emporix call**

Restart the server with the call probe from the top of this plan, then:

```bash
rm -f /tmp/emporix-calls.log
curl -s -o /dev/null http://localhost:3300/another-junk.txt
sleep 1 && cat /tmp/emporix-calls.log
```

Expected: empty. Before the guard this printed a `GET …/categories/<id>/assignments`
that came back 400.

- [ ] **Step 7: Commit**

```bash
git add examples/next-server-first/app/lib/site-context.ts examples/next-server-first/tests/languages.test.ts
git commit -m "fix(examples): validate the language before calling emporix"
```

---

### Task 1.2: `site-url.ts`, `robots.txt`, an icon, and the proxy matcher

**Files:**
- Create: `examples/next-server-first/app/lib/site-url.ts`
- Create: `examples/next-server-first/app/robots.ts`
- Create: `examples/next-server-first/app/icon.svg`
- Modify: `examples/next-server-first/proxy.ts:74-76`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `SITE_BASE_URL: URL` and `SITE_NAME: string` from `app/lib/site-url.ts`. Task 1.3 and PR 2 Tasks 2.2–2.5 all use them.
  - `/robots.txt` and `/icon.svg` as real routes. Task 1.3's sitemap URL is referenced from `robots.ts`, so both must agree on `/sitemap.xml`.

- [ ] **Step 1: Write `app/lib/site-url.ts`**

```ts
/**
 * Where this storefront lives, and what it is called.
 *
 * Absolute, and that is the reason this module exists in this PR rather than with
 * the rest of the metadata work: **`robots.txt` and `sitemap.xml` must carry
 * absolute URLs.** The sitemaps protocol requires it, and whether Next resolves a
 * relative entry against `metadataBase` is not documented — so this builds them
 * itself instead of relying on it. `alternates` in PR 2 is the opposite case: there
 * the resolution against `metadataBase` is documented behaviour, and the relative
 * form keeps the pages readable.
 *
 * The fallback is localhost rather than a guess at a production host — a wrong
 * absolute canonical points crawlers at somebody else's site, and an obviously
 * local one is the lesser failure. Set `SITE_BASE_URL` for a deployment.
 *
 * No server imports, so vitest and `generateStaticParams` can both load it.
 */
export const SITE_BASE_URL = new URL(process.env.SITE_BASE_URL ?? "http://localhost:3000");

/** The name in the tab, and the second half of every page title. */
export const SITE_NAME = "Server/First";

/** An absolute URL for a path — what robots.txt and sitemap.xml need. */
export function absoluteUrl(path: string): string {
  return new URL(path, SITE_BASE_URL).href;
}
```

- [ ] **Step 2: Ask for the env variable**

`.env*` files are edited by the repo owner, not by the implementer. Ask them to add to both
`examples/next-server-first/.env.example` and their `.env.local`:

```
# Absolute origin of this storefront. Used for robots.txt, sitemap.xml, canonical
# URLs and metadataBase. Falls back to http://localhost:3000 when unset.
SITE_BASE_URL=http://localhost:3000
```

The fallback means nothing blocks on this.

- [ ] **Step 3: Write `app/robots.ts`**

```ts
import type { MetadataRoute } from "next";
import { absoluteUrl } from "./lib/site-url";

/**
 * `/robots.txt` — and until 2026-08-06 this URL answered **500**.
 *
 * `/[lang]` matches any single path segment, `robots.txt` included, and the
 * language guard used to sit behind the Emporix call rather than in front of it.
 * A metadata route beats a dynamic segment, so this file also removes the URL
 * from `/[lang]`'s reach — measured: `200 text/plain` with this file, 500 without
 * it. It is the belt to Task 1.1's braces; neither substitutes for the other, and
 * every *other* dotted URL depends on the guard alone.
 *
 * A 5xx here is the most expensive answer this app can give: a crawler that gets
 * one stops crawling the host rather than guessing.
 *
 * The disallow list is the routes that are `ƒ` for a reason — per visitor, or
 * unbounded query space. `/debug` is on it although it is prerendered: it is
 * linked from the header of every page and describes the demo, not the shop.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/search", "/cart", "/checkout", "/login", "/account", "/debug", "/api/"],
      },
    ],
    // Absolute, because the sitemaps protocol says so — a relative path here is
    // ignored by every crawler that reads it strictly.
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
```

- [ ] **Step 4: Write `app/icon.svg`**

`/favicon.ico` answered 500 for the same reason `robots.txt` did. Task 1.1 turns it into a
404; an `app/icon.*` file makes the browser ask for the right URL in the first place, and
puts the demo's own mark in the tab. The redline slash is the logo in `header.tsx`.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="#eaeeec"/>
  <path d="M20 5 L12 27" stroke="#b8301a" stroke-width="3" stroke-linecap="square"/>
  <path d="M6 5 h6 M20 27 h6" stroke="#16232b" stroke-width="3" stroke-linecap="square"/>
</svg>
```

- [ ] **Step 5: Exclude the new routes from the proxy matcher**

In `examples/next-server-first/proxy.ts`, replace the config:

```ts
export const config = {
  // `sitemap.xml` and `icon.svg` join `robots.txt`: they are files for machines,
  // they carry no session and no language, and rotating a token for them is work
  // for nobody. `robots.txt` was already here before the routes existed.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|icon.svg).*)",
  ],
};
```

- [ ] **Step 6: Build and probe**

```bash
cd examples/next-server-first && pnpm build && npx next start -p 3300
```

```bash
curl -s -w '\n' http://localhost:3300/robots.txt
curl -s -o /dev/null -w 'icon.svg    %{http_code}  %{content_type}\n' http://localhost:3300/icon.svg
curl -s -o /dev/null -w 'favicon.ico %{http_code}\n' http://localhost:3300/favicon.ico
curl -s http://localhost:3300/de | grep -oE '<link rel="icon"[^>]*'
```

Expected: the robots body prints with the disallow list and an **absolute** `Sitemap:`
line; `icon.svg` `200 image/svg+xml`; `favicon.ico` `404` — a 404 for a file that is not
there is the right answer, and the `<link rel="icon">` in the HTML now points at
`/icon.svg`. The build table shows `○ /robots.txt` and `○ /icon.svg`.

- [ ] **Step 7: Commit**

```bash
git add examples/next-server-first/app/lib/site-url.ts examples/next-server-first/app/robots.ts examples/next-server-first/app/icon.svg examples/next-server-first/proxy.ts
git commit -m "feat(examples): add robots.txt and an icon route"
```

---

### Task 1.3: A sitemap out of the cached category tree

**Files:**
- Create: `examples/next-server-first/app/sitemap.ts`

**Interfaces:**
- Consumes: `categoryIndex(lang: string): Promise<CategoryIndex>` from `app/lib/category-tree.ts`; `LANGUAGES` from `app/lib/languages.ts`; `absoluteUrl` from Task 1.2. `CategoryIndex` has `roots: {id,label}[]` and `byId: Record<string, CategoryEntry>`.
- Produces: `/sitemap.xml`. PR 2 does **not** change this file; PR 4 adds products to it.

- [ ] **Step 1: Write `app/sitemap.ts`**

```ts
import type { MetadataRoute } from "next";
import { categoryIndex } from "./lib/category-tree";
import { LANGUAGES } from "./lib/languages";
import { absoluteUrl } from "./lib/site-url";

/**
 * Every URL this storefront wants found, in both languages.
 *
 * **Products are deliberately missing.** They need paging through the catalogue,
 * which is its own piece of work; the categories are free — `categoryIndex` is
 * already cached under the `emporix:categories` tag for the category pages, so
 * this route reads the same entry rather than asking Emporix again. On the `viu`
 * tenant that is 1'631 categories, so 3'264 URLs with the two entry pages —
 * comfortably inside the 50'000 per sitemap the protocol allows.
 *
 * `revalidate` matches the catalog routes. Without it the sitemap would be built
 * once and then keep a category tree that has moved on.
 *
 * The URLs are **absolute**, built by `absoluteUrl`. The sitemaps protocol requires
 * it, and a crawler that reads it strictly drops a relative entry rather than
 * guessing the host.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [];

  for (const lang of LANGUAGES) {
    const { byId } = await categoryIndex(lang);
    entries.push(
      { url: absoluteUrl(`/${lang}`), changeFrequency: "daily", priority: 1 },
      { url: absoluteUrl(`/${lang}/categories`), changeFrequency: "weekly", priority: 0.8 },
    );
    for (const id of Object.keys(byId)) {
      // Page one has no segment, so this is the same URL the category page's own
      // links use — one entry per category, not two.
      entries.push({
        url: absoluteUrl(`/${lang}/category/${encodeURIComponent(id)}`),
        changeFrequency: "weekly",
        priority: 0.6,
      });
    }
  }

  return entries;
}
```

- [ ] **Step 2: Build and count**

```bash
cd examples/next-server-first && pnpm build && npx next start -p 3300
```

```bash
curl -s http://localhost:3300/sitemap.xml -o /tmp/sm.xml -w 'sitemap %{http_code}  %{content_type}\n'
grep -c '<url>' /tmp/sm.xml
grep -c '/de/category/' /tmp/sm.xml
head -12 /tmp/sm.xml
```

Expected: `200 application/xml`; the `<url>` count is `2 × (2 + n)` where `n` is the
category count for the tenant (3'264 on `viu` at the time of writing); `de` and `en` both
present. If the count is 4, `categoryIndex` returned nothing — check `.env.local` before
changing the code.

- [ ] **Step 3: Verify it costs no extra Emporix call per request**

Restart with the call probe, then:

```bash
curl -s -o /dev/null http://localhost:3300/de/categories   # warms the tagged tree
rm -f /tmp/emporix-calls.log
curl -s -o /dev/null http://localhost:3300/sitemap.xml
sleep 1 && cat /tmp/emporix-calls.log
```

Expected: empty, or at most the anonymous login. The tree comes from the tag cache that
`/de/categories` already filled. If a `category-trees` GET shows up per request, the
`unstable_cache` wrapper is being bypassed — report it rather than working around it.

- [ ] **Step 4: Commit**

```bash
git add examples/next-server-first/app/sitemap.ts
git commit -m "feat(examples): add a sitemap covering both languages"
```

---

### Task 1.4: README, full verification, PR

**Files:**
- Modify: `examples/next-server-first/README.md`

- [ ] **Step 1: Add the section**

Place it after the rendering/caching section, wherever that sits in the current README:

```markdown
## What a crawler gets

`/[lang]` matches **any** single path segment, so `/robots.txt` used to land on the home
page with `Accept-Language: robots.txt`. Emporix answered `400 Language header validation
failed`, the throw beat the layout's `notFound()`, and the URL answered **500** — the one
status code that makes a crawler give up on the whole host. Measured 2026-08-06, together
with the second half of the bill: each junk URL rendered the home page in full, made real
Emporix calls, and left an ISR entry behind for an hour.

Two things fix it, and neither replaces the other:

- `siteContext(lang)` checks the language **before** the first Emporix call. The check in
  `[lang]/layout.tsx` was never enough — React renders layout and page concurrently, so the
  page's request is already in flight.
- `app/robots.ts`, `app/sitemap.ts` and `app/icon.svg` give the three URLs a crawler asks
  for first a real answer. A metadata route beats a dynamic segment.

`export const dynamicParams = false` looks like the one-line version of this and is not:
measured, it fixes the 500 and 404s every product and category page with it, because it
cascades to the child segments.

The sitemap lists both languages and every category, out of the tree that is already cached
for the category pages. Products are not in it yet.
```

- [ ] **Step 2: Full verification**

```bash
pnpm -F @viu/emporix-examples-next-server-first test
pnpm -F @viu/emporix-examples-next-server-first typecheck
cd examples/next-server-first && pnpm build
```

Expected: tests green, typecheck clean, and the route table shows four `●` catalog routes
plus `○ /robots.txt`, `○ /sitemap.xml`, `○ /icon.svg`.

- [ ] **Step 3: Commit, push, open the PR**

```bash
git add examples/next-server-first/README.md
git commit -m "docs(examples): document what a crawler gets"
git push origin fix/example-language-guard
```

Push over SSH — the `gh` token works for API calls but is rejected for git. Open the PR
against `main` with `gh pr create`, body covering: the measured 500 and its mechanism, the
disqualified `dynamicParams` alternative with its measurement, the two-part fix, and the
sitemap's missing products. **Do not merge.**

---

# PR 2 — Per-page metadata

Branch `feat/example-seo-metadata` off `main` after PR 1 is merged. If PR 1 is still open,
branch off it and say so in the PR body.

### Task 2.1: The canonical and hreflang builder

**Files:**
- Create: `examples/next-server-first/app/lib/seo.ts`
- Test: `examples/next-server-first/tests/seo.test.ts`

**Interfaces:**
- Consumes: `LANGUAGES`, `DEFAULT_LANGUAGE`, `Language` from `app/lib/languages.ts`. `SITE_BASE_URL`/`SITE_NAME` already exist from PR 1 Task 1.2.
- Produces: `alternatesFor(lang: Language, suffix: string): { canonical: string; languages: Record<string, string> }` from `app/lib/seo.ts`. `suffix` is the path **after** the language, starting with `/` or empty for the home page. Tasks 2.3–2.5 pass a `lang` already narrowed by `isLanguage`, so no cast is needed at the call sites.

- [ ] **Step 1: Write the failing test**

Create `examples/next-server-first/tests/seo.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { alternatesFor } from "../app/lib/seo";

describe("alternatesFor", () => {
  it("builds a self-referencing canonical", () => {
    expect(alternatesFor("de", "/product/abc").canonical).toBe("/de/product/abc");
    expect(alternatesFor("en", "/product/abc").canonical).toBe("/en/product/abc");
  });

  it("treats the empty suffix as the language home", () => {
    expect(alternatesFor("de", "").canonical).toBe("/de");
  });

  it("lists every language plus x-default", () => {
    const { languages } = alternatesFor("de", "/categories");
    expect(languages).toEqual({
      de: "/de/categories",
      en: "/en/categories",
      "x-default": "/de/categories",
    });
  });

  it("points x-default at the default language, not at the current one", () => {
    // Otherwise the English page would nominate itself as the fallback for every
    // locale nobody has a page for.
    expect(alternatesFor("en", "/categories").languages["x-default"]).toBe("/de/categories");
  });

  it("keeps a page suffix in every alternate", () => {
    const { canonical, languages } = alternatesFor("de", "/category/abc/3");
    expect(canonical).toBe("/de/category/abc/3");
    expect(languages.en).toBe("/en/category/abc/3");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm -F @viu/emporix-examples-next-server-first test
```

Expected: FAIL — `Cannot find module '../app/lib/seo'`.

- [ ] **Step 3: Write `app/lib/seo.ts`**

```ts
import { DEFAULT_LANGUAGE, LANGUAGES, type Language } from "./languages";

/**
 * The canonical URL of a page and its siblings in the other languages.
 *
 * One place, because the URL shape is a fact about this app that four routes
 * would otherwise each restate — and `hreflang` is only useful when every page
 * agrees about it.
 *
 * `suffix` is everything after the language: `/product/abc`, `/category/abc/3`,
 * or `""` for the language home. Relative on purpose; Next resolves both fields
 * against `metadataBase`.
 *
 * `x-default` points at the **default** language rather than at the current one.
 * A visitor whose locale we do not serve should land on German, whichever page
 * happens to be emitting the tag.
 *
 * Pure and free of server imports so vitest can load it — same rule as
 * `swap-language.ts` and `safe-next.ts`.
 */
export function alternatesFor(
  lang: Language,
  suffix: string,
): { canonical: string; languages: Record<string, string> } {
  const at = (l: string): string => `/${l}${suffix}`;
  const languages: Record<string, string> = {};
  for (const l of LANGUAGES) languages[l] = at(l);
  languages["x-default"] = at(DEFAULT_LANGUAGE);
  return { canonical: at(lang), languages };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm -F @viu/emporix-examples-next-server-first test
```

Expected: PASS, and the existing `languages`, `swap-language`, `path-language`,
`safe-next`, `category-index` and `strip-html` suites stay green.

- [ ] **Step 5: Commit**

```bash
git add examples/next-server-first/app/lib/seo.ts examples/next-server-first/tests/seo.test.ts
git commit -m "feat(examples): add a canonical and hreflang builder"
```

---

### Task 2.2: Root layout — `metadataBase`, title template, `<div lang>`

**Files:**
- Modify: `examples/next-server-first/app/layout.tsx:9`
- Modify: `examples/next-server-first/app/[lang]/layout.tsx:23-35`

**Interfaces:**
- Consumes: `SITE_BASE_URL`, `SITE_NAME` from `app/lib/site-url.ts`, created in PR 1 Task 1.2.
- Produces: a `title.template` of `"%s — Server/First"`, so every `generateMetadata` in Tasks 2.3–2.5 returns a **bare** title and never repeats the site name.

- [ ] **Step 1: Replace the metadata export in `app/layout.tsx`**

```ts
import type { Metadata } from "next";
import { SITE_BASE_URL, SITE_NAME } from "./lib/site-url";
```

```ts
/**
 * The shell's metadata, and the template every page title goes through.
 *
 * Until 2026-08-06 this was one line with one title, and all 22 routes shared it —
 * measured: the product page, the cart and the category listing all said «Emporix
 * SDK — server-first example». A `template` means each page returns only its own
 * half and the site name is written once.
 *
 * `metadataBase` is what turns the relative `canonical` and `hreflang` values from
 * `lib/seo.ts` into absolute URLs. Without it Next warns and emits relative hrefs,
 * which a crawler resolves against whatever host it happened to use.
 */
export const metadata: Metadata = {
  metadataBase: SITE_BASE_URL,
  title: { default: SITE_NAME, template: `%s — ${SITE_NAME}` },
  description:
    "A server-first Emporix storefront: the catalogue is static and cached, the session never reaches the browser.",
};
```

- [ ] **Step 2: Wrap the language subtree in `app/[lang]/layout.tsx`**

Replace the return statement:

```tsx
  if (!isLanguage(lang)) notFound();
  // `lang` on a wrapper, because only the ROOT layout may render `<html>` and it
  // cannot see this segment's params. `lang` is valid on any element and the
  // nearest ancestor wins, so this is correct for assistive technology and for
  // the crawlers that read the attribute — while `<html lang="en">` stays true of
  // the shell around it, whose UI text really is English.
  //
  // The proper fixes both cost more than this demo should spend here: two root
  // layouts via route groups turns every navigation between the catalog and a
  // session route into a full document load, and moving the session routes under
  // `/[lang]/…` is option B in
  // docs/superpowers/specs/2026-08-05-language-write-from-proxy.md.
  //
  // The wrapper is layout-neutral: global.css styles `html` and `body` only, with
  // no `body > *` rule and no flex or grid on `body`.
  return <div lang={lang}>{children}</div>;
```

- [ ] **Step 3: Build and probe**

```bash
cd examples/next-server-first && pnpm build && npx next start -p 3300
```

```bash
curl -s http://localhost:3300/de | grep -oE '<html[^>]*lang="[^"]*"|<div lang="[^"]*"|<title>[^<]*|<link rel="canonical"[^>]*' | head -5
```

Expected: `<html lang="en">`, a `<div lang="de">`, and `<title>Server/First</title>` — the
default, because `/[lang]` has no `generateMetadata` yet. No canonical yet either. The
route table still shows four `●`.

- [ ] **Step 4: Check the layout did not shift**

```bash
curl -s -o /dev/null -w '%{size_download}\n' http://localhost:3300/de
```

Open `http://localhost:3300/de` in a browser and confirm the annotation rail still sits
beside the content rather than under it. The `.sheet` grid lives inside `<main>`, so a
wrapper above it cannot reach it — but look once rather than assume.

- [ ] **Step 5: Commit**

```bash
git add examples/next-server-first/app/layout.tsx "examples/next-server-first/app/[lang]/layout.tsx"
git commit -m "feat(examples): add a metadata base and a per-language lang attribute"
```

---

### Task 2.3: `generateMetadata` for the home and the category listing

**Files:**
- Modify: `examples/next-server-first/app/[lang]/page.tsx:32`
- Modify: `examples/next-server-first/app/[lang]/categories/page.tsx:19`

**Interfaces:**
- Consumes: `alternatesFor` from Task 2.1; the `title.template` from Task 2.2; `isLanguage` from `app/lib/languages.ts`; `SITE_NAME` from `app/lib/site-url.ts`; `categoryIndex` from `app/lib/category-tree.ts`.
- Produces: nothing later tasks depend on. The narrowing pattern established here — an early `if (!isLanguage(lang)) return {}` so `lang` is a `Language` from then on, with **no cast** — is reused in Tasks 2.4 and 2.5.

- [ ] **Step 1: Add `generateMetadata` to `app/[lang]/page.tsx`**

Below the existing `export const revalidate = 3600;`:

```ts
import type { Metadata } from "next";
import { isLanguage } from "../lib/languages";
import { alternatesFor } from "../lib/seo";
import { SITE_NAME } from "../lib/site-url";
```

```ts
/**
 * Costs no extra Emporix call — measured 2026-08-06 with a `diagnostics_channel`
 * probe on `undici:request:create`: a cold product page is four upstream calls
 * with and without a `generateMetadata` that repeats the page's own read, because
 * Next memoizes identical fetches within one request. This page reads nothing at
 * all here, so the question does not even arise; it is written down because the
 * next two tasks rely on it.
 *
 * The title carries no site name: `title.template` in the root layout appends it.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  // `generateMetadata` runs BEFORE the page body, so this is the first place a
  // junk segment can arrive — `siteContext` has not had its turn yet. It is also
  // what narrows `lang` from `string` to `Language` for the call below, which is
  // why no cast appears there.
  if (!isLanguage(lang)) return {};
  return {
    title: "Catalog",
    description:
      "Products from one priced category of the viu tenant, rendered once and served from the cache.",
    alternates: alternatesFor(lang, ""),
    openGraph: { type: "website", title: "Catalog", siteName: SITE_NAME },
  };
}
```

- [ ] **Step 2: Add `generateMetadata` to `app/[lang]/categories/page.tsx`**

```ts
import type { Metadata } from "next";
import { isLanguage } from "../../lib/languages";
import { alternatesFor } from "../../lib/seo";
import { SITE_NAME } from "../../lib/site-url";
import { categoryIndex } from "../../lib/category-tree";
```

```ts
export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  if (!isLanguage(lang)) return {};
  // The same cached index the page renders from, so this is a cache read rather
  // than a second tree fetch. The count is the one honest thing there is to say
  // about a list of category names.
  const { roots } = await categoryIndex(lang);
  return {
    title: "Categories",
    description: `${roots.length} category trees, drillable down to every leaf the tenant publishes.`,
    alternates: alternatesFor(lang, "/categories"),
    openGraph: { type: "website", title: "Categories", siteName: SITE_NAME },
  };
}
```

- [ ] **Step 3: Build, probe, count calls**

Start with the call probe attached.

```bash
curl -s -o /dev/null http://localhost:3300/de/categories   # warm
rm -f /tmp/emporix-calls.log
curl -s http://localhost:3300/en/categories -o /tmp/c.html
sleep 1 && cat /tmp/emporix-calls.log
grep -oE '<title>[^<]*|rel="canonical"[^>]*|hreflang="[^"]*" href="[^"]*' /tmp/c.html
```

Expected: at most one `category-trees` GET for the `en` tree (a different cache key from
`de`, so one is correct — two is not); `<title>Categories — Server/First</title>`; a
canonical of `http://localhost:3000/en/categories`; three `hreflang` entries.

- [ ] **Step 4: Commit**

```bash
git add "examples/next-server-first/app/[lang]/page.tsx" "examples/next-server-first/app/[lang]/categories/page.tsx"
git commit -m "feat(examples): add metadata to the catalog entry pages"
```

---

### Task 2.4: `generateMetadata` for the product page

**Files:**
- Modify: `examples/next-server-first/app/[lang]/product/[id]/[[...variant]]/page.tsx:39`

**Interfaces:**
- Consumes: `alternatesFor`; `getEmporixClient`, `siteContext`, `TIMEOUTS`, `productName`, `pickText`, `stripHtml`, `type Product`, `EmporixNotFoundError` — all already imported by this file except `Metadata`, `isLanguage`, `SITE_NAME` and `alternatesFor`.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Add the import lines**

```ts
import type { Metadata } from "next";
import { isLanguage } from "../../../../lib/languages";
import { alternatesFor } from "../../../../lib/seo";
import { SITE_NAME } from "../../../../lib/site-url";
```

- [ ] **Step 2: Add `generateMetadata` below `generateStaticParams`**

```ts
/**
 * Free, measured. 2026-08-06 with a `diagnostics_channel` probe on
 * `undici:request:create`: a cold product page made four upstream calls with this
 * function present and four without it, and `GET /product/viu/products/<id>`
 * appeared exactly **once** although both this function and the page body ask for
 * it. Next memoizes identical fetches within a request, so no memo layer is
 * needed here — and if that ever changes, the probe is how you find out.
 *
 * **The canonical drops the variant segment.** `/de/product/x/anything` renders
 * 200 today, and a self-referencing canonical would bless every one of those as
 * its own document. Every variant points at the parent instead: one line, no
 * extra call, and the right answer for near-identical variant pages regardless.
 * It does not remove the junk URLs — that is the segment validation in the next
 * PR — it stops them competing with the real one.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}): Promise<Metadata> {
  const { lang, id } = await params;
  if (!isLanguage(lang)) return {};
  const client = getEmporixClient({ context: await siteContext(lang), timeouts: TIMEOUTS });

  let product: Product;
  try {
    product = await client.products.get(id, undefined, undefined);
  } catch (e) {
    // The page renders `notFound()` for this same case a moment later. Returning
    // the empty object keeps the 404 page's own title instead of throwing twice.
    if (e instanceof EmporixNotFoundError) return {};
    throw e;
  }

  const name = productName(product);
  const description = stripHtml(
    pickText((product as { description?: unknown }).description, ""),
  );
  // 160 characters is where search engines cut a description. Truncating at a word
  // boundary rather than mid-word, and only when there is something to truncate.
  const short =
    description.length > 160 ? `${description.slice(0, 157).replace(/\s+\S*$/, "")}…` : description;

  return {
    title: name,
    ...(short !== "" ? { description: short } : {}),
    alternates: alternatesFor(lang, `/product/${encodeURIComponent(id)}`),
    openGraph: {
      type: "website",
      title: name,
      siteName: SITE_NAME,
      ...(short !== "" ? { description: short } : {}),
    },
  };
}
```

- [ ] **Step 3: Build and verify the call count did not move**

Start with the call probe attached, then use a product id the cache has not seen:

```bash
curl -s -o /dev/null http://localhost:3300/de     # warm the anonymous token
rm -f /tmp/emporix-calls.log
PID=$(curl -s http://localhost:3300/de | grep -oE 'href="/de/product/[^"/]*"' | head -1 | sed 's/href="//;s/"//')
curl -s "http://localhost:3300$PID" -o /tmp/p.html
sleep 1 && sort /tmp/emporix-calls.log | uniq -c
grep -oE '<title>[^<]*|rel="canonical"[^>]*' /tmp/p.html
```

Expected: `GET /product/viu/products/<id>` with a count of **1**, and four upstream calls
in total (`products/<id>`, `products` for the variant children, `match-prices-by-context`,
and possibly the anonymous login). The title is the product name. If `products/<id>` shows
a count of 2, memoization is not holding — stop and report it, do not paper over it with a
cache wrapper.

- [ ] **Step 4: Verify a bogus variant now points at the real URL**

```bash
curl -s "http://localhost:3300$PID/bogus" | grep -oE 'rel="canonical" href="[^"]*'
```

Expected: the canonical of the **parent** product, without `/bogus`.

- [ ] **Step 5: Commit**

```bash
git add "examples/next-server-first/app/[lang]/product/[id]/[[...variant]]/page.tsx"
git commit -m "feat(examples): add product metadata with a variant-free canonical"
```

---

### Task 2.5: `generateMetadata` for the paginated category page

**Files:**
- Modify: `examples/next-server-first/app/[lang]/category/[id]/[[...page]]/page.tsx:39`

**Interfaces:**
- Consumes: `alternatesFor`; `categoryIndex`, already imported by this file from `../../../../lib/category-tree`.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Add the import lines**

```ts
import type { Metadata } from "next";
import { isLanguage } from "../../../../lib/languages";
import { alternatesFor } from "../../../../lib/seo";
import { SITE_NAME } from "../../../../lib/site-url";
```

- [ ] **Step 2: Add `generateMetadata` below `generateStaticParams`**

```ts
/**
 * The page number is part of the title and part of the canonical, and both matter.
 *
 * A paginated list **self-canonicalises**: page 3 is its own document, not a
 * duplicate of page 1, and pointing it at page 1 would hide its products from
 * search entirely. The one exception is the page-1 alias — `/de/category/x/1`
 * renders the same HTML as `/de/category/x`, so it canonicalises to the bare URL.
 * The same `page <= 1` rule the `href()` helper below uses, for the same reason.
 *
 * Reads the cached index, so no extra Emporix call: the page body asks for the
 * same entry a moment later and gets the memoized answer.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; id: string; page?: string[] }>;
}): Promise<Metadata> {
  const { lang, id, page: segments } = await params;
  if (!isLanguage(lang)) return {};
  const page = Math.max(1, Number(segments?.[0]) || 1);

  const { byId } = await categoryIndex(lang);
  const entry = byId[id];
  // The page renders `notFound()` for this case; an empty object leaves the 404
  // page its own title.
  if (entry === undefined) return {};

  const title = page > 1 ? `${entry.label} — page ${page}` : entry.label;
  const where =
    entry.path.length > 0 ? ` in ${entry.path.map((a) => a.label).join(" / ")}` : "";
  const suffix =
    page > 1
      ? `/category/${encodeURIComponent(id)}/${page}`
      : `/category/${encodeURIComponent(id)}`;

  return {
    title,
    description: `${entry.label}${where}${entry.children.length > 0 ? ` · ${entry.children.length} subcategories` : ""}.`,
    alternates: alternatesFor(lang, suffix),
    openGraph: { type: "website", title, siteName: SITE_NAME },
  };
}
```

- [ ] **Step 3: Build and probe all four pagination shapes**

```bash
cd examples/next-server-first && pnpm build && npx next start -p 3300
CAT=/de/category/2c3f70c7-918b-5b2b-95ba-fc378011c170
curl -s "http://localhost:3300$CAT"   | grep -oE '<title>[^<]*|rel="canonical" href="[^"]*'
curl -s "http://localhost:3300$CAT/1" | grep -oE '<title>[^<]*|rel="canonical" href="[^"]*'
curl -s "http://localhost:3300$CAT/2" | grep -oE '<title>[^<]*|rel="canonical" href="[^"]*'
```

Expected: the bare URL and `/1` produce the **same** canonical — the bare one — while `/2`
canonicalises to itself and its title carries «page 2». Use a category with more than 24
products if `/2` comes back empty; the canonical is what matters here, not the tiles.

- [ ] **Step 4: Commit**

```bash
git add "examples/next-server-first/app/[lang]/category/[id]/[[...page]]/page.tsx"
git commit -m "feat(examples): add paginated category metadata"
```

---

### Task 2.6: Keep the per-visitor routes out of the index

**Files:**
- Modify: `examples/next-server-first/app/search/page.tsx`
- Modify: `examples/next-server-first/app/cart/page.tsx`
- Modify: `examples/next-server-first/app/checkout/page.tsx`
- Modify: `examples/next-server-first/app/checkout/done/page.tsx`
- Modify: `examples/next-server-first/app/login/page.tsx`
- Modify: `examples/next-server-first/app/account/page.tsx`
- Modify: `examples/next-server-first/app/account/addresses/page.tsx`
- Modify: `examples/next-server-first/app/account/orders/page.tsx`
- Modify: `examples/next-server-first/app/account/orders/[id]/page.tsx`
- Modify: `examples/next-server-first/app/account/profile/page.tsx`
- Modify: `examples/next-server-first/app/debug/page.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Add a static metadata export to each file**

`robots.txt` from PR 1 already asks crawlers not to fetch these. This is the second lock:
a `Disallow` stops the fetch but does **not** stop the URL being indexed from an inbound
link, and a `noindex` does. Both, because they fail in different directions.

The eleven exports differ only in the title. Add near the top of each file, after the
imports:

```ts
import type { Metadata } from "next";

/**
 * `noindex, follow`: this page is per visitor, so an index entry for it is either
 * wrong or somebody else's data. `follow` stays on so the catalog links on it
 * still pass through. `robots.txt` disallows the path as well — a Disallow stops
 * the fetch, a noindex stops the indexing, and an inbound link defeats only the
 * first of the two.
 */
export const metadata: Metadata = {
  title: "Your bag",
  robots: { index: false, follow: true },
};
```

Titles per file, matching the existing `<h1>` of each page:

| File | `title` |
|---|---|
| `app/cart/page.tsx` | `"Your bag"` |
| `app/search/page.tsx` | `"Search"` |
| `app/checkout/page.tsx` | `"Checkout"` |
| `app/checkout/done/page.tsx` | `"Order placed"` |
| `app/login/page.tsx` | `"Sign in"` |
| `app/account/page.tsx` | `"Account"` |
| `app/account/addresses/page.tsx` | `"Addresses"` |
| `app/account/orders/page.tsx` | `"Orders"` |
| `app/account/orders/[id]/page.tsx` | `"Order"` |
| `app/account/profile/page.tsx` | `"Profile"` |
| `app/debug/page.tsx` | `"Debug"` |

Write the full doc comment on `app/cart/page.tsx` only; the other ten get a one-liner
pointing at it:

```ts
/** Per visitor — see the reasoning on `app/cart/page.tsx`. */
```

If a file already exports `metadata`, merge rather than add a second export — a duplicate
export is a build error, so `pnpm build` catches it.

- [ ] **Step 2: Build and verify all eleven**

```bash
cd examples/next-server-first && pnpm build && npx next start -p 3300
curl -s http://localhost:3300/cart          | grep -c 'name="robots" content="noindex'
curl -s 'http://localhost:3300/search?q=x'  | grep -c 'name="robots" content="noindex'
curl -s http://localhost:3300/debug         | grep -c 'name="robots" content="noindex'
curl -s http://localhost:3300/de            | grep -c 'name="robots" content="noindex'
```

Expected: `1`, `1`, `1`, and **`0`** for the catalog page. Check the remaining seven the
same way; `/account/*` and `/checkout` redirect to `/login` without a session, so follow
the redirect with `-L` and confirm the login page carries the tag.

- [ ] **Step 3: Commit**

```bash
git add examples/next-server-first/app
git commit -m "feat(examples): keep the per-visitor routes out of the index"
```

---

### Task 2.7: README, full verification, PR

**Files:**
- Modify: `examples/next-server-first/README.md`

- [ ] **Step 1: Extend the «What a crawler gets» section from PR 1**

```markdown
### Per-page metadata

Every route used to share one `<title>`, and there was no description, canonical, hreflang
or Open Graph tag anywhere — measured 2026-08-06, zero of each on all six pages probed.

- `metadataBase` comes from `SITE_BASE_URL`, falling back to localhost. A wrong absolute
  canonical points crawlers at somebody else's site, so the fallback is deliberately local.
- `title.template` in the root layout appends the site name, so each page returns only its
  own half.
- `lib/seo.ts` builds the canonical and the `hreflang` set in one place. `x-default` points
  at the default language rather than at the emitting page.
- A product canonical **drops the variant segment**, so `/de/product/x/anything` stops
  competing with `/de/product/x`. A paginated category **self-canonicalises** from page 2
  on, because page 3 is its own document — only the `/1` alias folds back to the bare URL.
- The per-visitor routes carry `noindex, follow` *and* a `Disallow` in `robots.txt`. A
  Disallow stops the fetch, a noindex stops the indexing, and an inbound link defeats only
  the first.

`generateMetadata` costs no extra Emporix call: measured with a `diagnostics_channel` probe
on `undici:request:create`, a cold product page is four upstream calls whether or not
`generateMetadata` repeats the page's own `products.get`. Next memoizes identical fetches
within a request.

**What is still missing.** `<html lang>` says `en` on every page; only the root layout may
render `<html>` and it cannot see the `[lang]` segment, so the language sits on a wrapper
inside it. No JSON-LD, and no products in the sitemap. Structured data and the catalog
sitemap are the next piece of work; `<html lang>` follows the session routes moving under
`/[lang]/…`.
```

- [ ] **Step 2: Full verification**

```bash
pnpm -F @viu/emporix-examples-next-server-first test
pnpm -F @viu/emporix-examples-next-server-first typecheck
cd examples/next-server-first && pnpm build
```

Expected: all suites green including the new `seo.test.ts`; typecheck clean; the route
table shows the same four `●` catalog routes and the same `ƒ` set as before this PR — if a
catalog route flipped to `ƒ`, a `generateMetadata` is reading cookies or headers somewhere.

- [ ] **Step 3: One last full sweep of the measured table**

Re-run the probe from the analysis and compare against the «before» column:

```bash
npx next start -p 3300
PID=$(curl -s http://localhost:3300/de | grep -oE 'href="/de/product/[^"/]*"' | head -1 | sed 's/href="//;s/"//')
curl -s "http://localhost:3300$PID" | grep -cE 'name="description"|rel="canonical"|hreflang|property="og:'
```

Expected: at least 6 (description, canonical, three hreflang, one or more `og:`), where the
same command returned 0 before. If `PID` comes back empty the home page has no product
tiles — check `.env.local` rather than the metadata code.

- [ ] **Step 4: Commit, push, open the PR**

```bash
git add examples/next-server-first/README.md
git commit -m "docs(examples): document the seo metadata"
git push origin feat/example-seo-metadata
```

PR body: the before/after table of the six measured tags, the free-metadata measurement,
the two canonical decisions and why, and the three things left open. **Do not merge.**

---

## What these two PRs deliberately do not do

- **JSON-LD.** Product, Offer and BreadcrumbList belong in the next PR, together with the
  question of whether the Schema.org mapping of Emporix shapes belongs in
  `@viu/emporix-sdk-next` rather than in an example.
- **Products in the sitemap.** Needs paging through the catalogue.
- **The junk URLs themselves.** `/de/category/x/0`, `/2/3/4`, `/99999` and
  `/de/product/x/bogus` all still answer 200 and still buy an ISR entry. PR 2 stops them
  competing for the canonical; the segment validation that makes them 404 is PR 3, along
  with bounding `expireTime` away from its one-year default.
- **`<html lang>`.** See Task 2.2.
- **The redirect hop on `/` and `/categories`.** Both are `ƒ`, both answer 307 by cookie,
  and the header links to them unprefixed from every page — so which target a crawler sees
  depends on a cookie it does not keep. Pointing the header at the language-prefixed URL
  needs the header to know the language, which needs it inside the `[lang]` tree, which is
  the same route-group or option-B decision as `<html lang>`. All three move together or
  not at all.
- **`Set-Cookie` on cacheable catalog HTML.** Needs the language cookie gone, which needs
  the session routes under `/[lang]/…`.
- **`next-app-router`.** Its own example, its own PR: six of six routes dynamic because the
  root layout reads cookies, and a product `<h1>` that renders the id because
  `typeof data.name === "string"` is false for a locale map.
