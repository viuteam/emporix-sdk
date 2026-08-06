# SEO: URL discipline and structured data — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `examples/next-server-first` answering 200 to twelve URL shapes that are not
documents, bound the stale window away from its one-year default, and give the catalog
pages Product and BreadcrumbList structured data plus a sitemap that contains the products.

**Architecture:** Two PRs on one example, continuing #240 and #241, no package change. PR 3
is validation: one pure parser for the page segment, one check for the variant segment, one
config line for `expireTime`. PR 4 is output: one pure module that maps the demo's own view
data to Schema.org and escapes it for a `<script>` tag, wired into two pages, plus the
product walk the sitemap has been missing.

**Tech Stack:** Next 16.2.12 App Router, `@viu/emporix-sdk`, `@viu/emporix-sdk-next`,
`@viu/emporix-examples-shared`, vitest.

## Global Constraints

- **Everything written into the repo is English** — comments, JSDoc, commit messages, PR
  bodies, README prose, test names. See `CLAUDE.md`.
- **Commitlint:** scope from `repo, release, sdk, react, core, customer, product, category,
  cart, checkout, payment, price, media, segment, availability, auth, http, logger, deps,
  docs, examples`. No `next` scope — use `examples`. First word after the scope is a
  lowercase verb.
- **No changeset.** Both PRs touch only `examples/next-server-first`, and
  `@viu/emporix-examples-*` are under `ignore` in `.changeset/config.json`.
- **The route table must not regress.** `/[lang]`, `/[lang]/categories`,
  `/[lang]/category/[id]/[[...page]]` and `/[lang]/product/[id]/[[...variant]]` stay `●` in
  `next build`. Any `cookies()` or `headers()` read in their tree turns them `ƒ`.
- **Never invent structured data.** A `<script type="application/ld+json">` that contradicts
  the page is worse than no script at all. Everything emitted must come from data the page
  actually has.
- **Do not merge either PR.** Open it and stop.

## Measurements this plan is built on

Against `next start` on a production build of merged `main` (#240 and #241 in), `viu`
tenant, 2026-08-06.

### The URL surface, before

Twelve shapes, twelve `200`s. `CAT` is a real category, `PID` a real product:

| URL | status | canonical it emits |
|---|---|---|
| `CAT` | 200 | itself |
| `CAT/1` | 200 | the bare URL ✓ (from #241) |
| `CAT/0` | 200 | the bare URL |
| `CAT/2` | 200 | itself ✓ |
| `CAT/99999` | 200 | **itself** — a soft-404 nominating itself as canonical |
| `CAT/abc` | 200 | the bare URL |
| `CAT/2/3/4` | 200 | `CAT/2` |
| `CAT/-1` | 200 | the bare URL |
| `CAT/01` | 200 | the bare URL |
| `PID` | 200 | itself ✓ |
| `PID/bogus` | 200 | the parent ✓ (from #241) |
| `PID/a/b/c` | 200 | the parent ✓ |

\#241's self-canonical rule is right for real pages and made the `CAT/99999` case slightly
**worse**: the page now tells a crawler that this empty page is the canonical version of
itself. That is the one row this plan has to fix rather than improve.

### `expireTime` moves the stale window, and by exactly this arithmetic

`expireTime: 86400` in `next.config.mjs` → build table `Expire: 1d` and:

```
Cache-Control: s-maxage=3600, stale-while-revalidate=82800
```

`82800 = 86400 − 3600`, so Next computes `swr = expireTime − revalidate`. The default 1 year
produced `31532400 = 31536000 − 3600`. Confirmed by measurement, not read from docs.

### Emporix rejects an absurd `pageNumber`, so the parser needs an upper bound

| `pageNumber` | result |
|---|---|
| 99'999 | `200`, 0 items, `hasNextPage: false` |
| 1e15 | **`400 EmporixValidationError`** |
| 1e21 | **400** |
| `MAX_SAFE_INTEGER` | **400** |

An empty page can be turned into a 404 by looking at the result. A 400 cannot — it would
surface as a 500, which is the exact class of bug #240 fixed. Hence a bound, justified by
this table rather than by caution.

### The catalogue, and what structured data can honestly say about it

| | measured |
|---|---|
| products | **876** (5 pages of 200) |
| product fields | `code, description, id, media, metadata, mixins, name, productType, published, taxClasses, yrn` |
| `gtin` / `sku` / `ean` | **absent** — `code` (`iam-jit-access`) is the merchant code and is what maps to Schema.org `sku` |
| `media` | `[]` on every product sampled — no `image` to emit |
| price fields | `currency, effectiveValue, originalValue, totalValue, includesTax, tax, priceId, itemId, …` |
| `metadata.modifiedAt` | present (`2026-04-15T14:06:53.271Z`) — real `lastModified` for the sitemap |
| descriptions containing `<` | **0 of 200** |

That last row is the argument for escaping the JSON-LD rather than a reason to skip it: an
unescaped implementation passes every test anyone would write against this tenant today and
breaks on the first merchant who pastes HTML into a description. It is a trust boundary, so
it gets a test that feeds it `</script>`.

### Availability cannot be stated, only invented

```
availability.get(id, "main")      → 404 EmporixNotFoundError
availability.getMany(ids, "main") → 5 records, every one { available: false }
```

The tenant carries **no** availability records; `getMany` synthesises `available: false` for
anything absent. So the three options for `offers.availability` are: omit it, invent
`InStock`, or emit `OutOfStock` for products whose «Add to cart» button demonstrably works.
The second is a lie and the third contradicts the page — both are worse than silence.
**Omit, and document.**

## Decisions

**JSON-LD lives in the example, not in `@viu/emporix-sdk-next`.** The Schema.org mapping is
reusable in principle and there is exactly one consumer: this demo. `storefront-demo` is a
client-rendered SPA, where a JSON-LD block is worth far less, so a second consumer is not
waiting. Publishing it now would add public API surface, a changeset and a documentation
obligation for one caller. The promotion criterion, written down so it is a decision and not
an oversight: **when a second server-rendered consumer needs it, move `productJsonLd` and
`breadcrumbJsonLd` into the package unchanged** — they are already pure and free of SDK
types for exactly that reason.

**`CAT/1` redirects, everything else 404s.** `/1` is a URL a human would type and another
site might link; a permanent redirect to the canonical keeps that link working and collapses
the duplicate. `/0`, `/abc`, `/-1`, `/01`, `/2/3/4` and a page past the last one are not
documents anybody meant, and a 404 is the honest answer.

**The variant segment is validated against the real children.** On this tenant that means
any variant segment 404s, because no product is a `PARENT_VARIANT` (300 swept 2026-08-03).
That is correct, not a regression: `/de/product/x/bogus` was never a document.

---

## File structure

### PR 3 — `fix/example-url-discipline`

| File | Responsibility |
|---|---|
| `app/lib/page-segment.ts` (create) | `parsePageSegment` — the one place that decides what a `[[...page]]` segment means. Pure, no server imports, so vitest can load it. |
| `tests/page-segment.test.ts` (create) | Every shape from the measured table above, plus the bound. |
| `app/[lang]/category/[id]/[[...page]]/page.tsx` (modify) | Uses the parser in both `generateMetadata` and the page; 404s a page past the last one and loses the «Nothing on page N» branch. |
| `app/[lang]/product/[id]/[[...variant]]/page.tsx` (modify) | 404s a variant segment that is not a child id. |
| `next.config.mjs` (modify) | `expireTime`. |
| `README.md` (modify) | Extends «What a crawler gets». |

### PR 4 — `feat/example-structured-data`

| File | Responsibility |
|---|---|
| `app/lib/json-ld.ts` (create) | `productJsonLd`, `breadcrumbJsonLd`, `jsonLdScript`. Pure, no SDK and no server imports — the shape that makes it promotable to the package later. |
| `tests/json-ld.test.ts` (create) | The mapping, the omissions, and the `</script>` escape. |
| `app/[lang]/product/[id]/[[...variant]]/page.tsx` (modify) | Emits the Product script. |
| `app/[lang]/category/[id]/[[...page]]/page.tsx` (modify) | Emits the BreadcrumbList script. |
| `app/sitemap.ts` (modify) | Adds all products with `lastModified`, one catalogue walk shared by both languages. |
| `README.md` (modify) | Extends the SEO section. |

---

# PR 3 — URL discipline

### Task 3.1: The page-segment parser

**Files:**
- Create: `examples/next-server-first/app/lib/page-segment.ts`
- Test: `examples/next-server-first/tests/page-segment.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export const MAX_PAGE = 10_000;
  export type PageSegment =
    | { kind: "page"; page: number }
    | { kind: "alias" }
    | { kind: "invalid" };
  export function parsePageSegment(segments: string[] | undefined): PageSegment;
  ```
  Task 3.2 imports `parsePageSegment` in the category page. `"alias"` means «this is the
  page-1 duplicate, redirect permanently to the bare URL».

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { MAX_PAGE, parsePageSegment } from "../app/lib/page-segment";

describe("parsePageSegment", () => {
  it("treats a missing segment as page one", () => {
    expect(parsePageSegment(undefined)).toEqual({ kind: "page", page: 1 });
    expect(parsePageSegment([])).toEqual({ kind: "page", page: 1 });
  });

  it("calls an explicit 1 an alias of the bare URL", () => {
    // `/de/category/x/1` renders exactly what `/de/category/x` renders. It is a URL
    // a human would type, so it redirects rather than 404s.
    expect(parsePageSegment(["1"])).toEqual({ kind: "alias" });
  });

  it("accepts a real page number", () => {
    expect(parsePageSegment(["2"])).toEqual({ kind: "page", page: 2 });
    expect(parsePageSegment(["10"])).toEqual({ kind: "page", page: 10 });
    expect(parsePageSegment([String(MAX_PAGE)])).toEqual({ kind: "page", page: MAX_PAGE });
  });

  it("rejects everything that is not a page number", () => {
    // Measured 2026-08-06: every one of these answered 200 before.
    expect(parsePageSegment(["0"])).toEqual({ kind: "invalid" });
    expect(parsePageSegment(["-1"])).toEqual({ kind: "invalid" });
    expect(parsePageSegment(["01"])).toEqual({ kind: "invalid" });
    expect(parsePageSegment(["abc"])).toEqual({ kind: "invalid" });
    expect(parsePageSegment(["1.5"])).toEqual({ kind: "invalid" });
    expect(parsePageSegment(["1e3"])).toEqual({ kind: "invalid" });
    expect(parsePageSegment([""])).toEqual({ kind: "invalid" });
    expect(parsePageSegment([" 2"])).toEqual({ kind: "invalid" });
  });

  it("rejects more than one segment", () => {
    // `/de/category/x/2/3/4` used to render page 2 and claim page 2's canonical.
    expect(parsePageSegment(["2", "3", "4"])).toEqual({ kind: "invalid" });
    expect(parsePageSegment(["1", "1"])).toEqual({ kind: "invalid" });
  });

  it("rejects a page number Emporix would reject", () => {
    // Measured: pageNumber 99'999 answers 200 with an empty list, 1e15 and above
    // answer 400 — which would surface as a 500. The bound keeps that unreachable.
    expect(parsePageSegment([String(MAX_PAGE + 1)])).toEqual({ kind: "invalid" });
    expect(parsePageSegment(["1000000000000000"])).toEqual({ kind: "invalid" });
    expect(parsePageSegment([String(Number.MAX_SAFE_INTEGER)])).toEqual({ kind: "invalid" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm -F @viu/emporix-examples-next-server-first test
```

Expected: FAIL — `Cannot find module '../app/lib/page-segment'`.

- [ ] **Step 3: Write the module**

```ts
/**
 * What a `[[...page]]` segment means, decided in one place.
 *
 * Before this, `Math.max(1, Number(segments?.[0]) || 1)` mapped `0`, `-1`, `abc` and
 * a missing segment all onto page 1, and ignored extra segments entirely. Measured
 * 2026-08-06: nine different category URLs answered 200, four of them rendering page
 * one under a URL that is not page one, and `…/99999` answering 200 with «Nothing on
 * page 99999» while nominating itself as its own canonical.
 *
 * Three outcomes rather than a number, because the three need different HTTP answers:
 * a page renders, an alias redirects, an invalid segment 404s. A parser that returned
 * a number could not express that difference and the caller would have to re-derive
 * it.
 *
 * Pure and free of server imports so vitest can load it — same rule as `seo.ts` and
 * `safe-next.ts`.
 */

/**
 * The largest page number this app will forward to Emporix.
 *
 * Not arbitrary caution: measured 2026-08-06, `pageNumber: 99999` answers 200 with an
 * empty list, but 1e15 and above answer `400 EmporixValidationError` — which would
 * surface as a 500. An empty page can be turned into a 404 by looking at the result;
 * a 400 cannot.
 *
 * 10'000 pages is 240'000 products in one category at the page size this app uses. No
 * URL beyond that was ever a page somebody reached.
 */
export const MAX_PAGE = 10_000;

export type PageSegment =
  /** Render this page. `page` is 1 when the segment is absent. */
  | { kind: "page"; page: number }
  /** The page-one duplicate — redirect permanently to the bare URL. */
  | { kind: "alias" }
  /** Not a document. 404. */
  | { kind: "invalid" };

export function parsePageSegment(segments: string[] | undefined): PageSegment {
  if (segments === undefined || segments.length === 0) return { kind: "page", page: 1 };
  if (segments.length > 1) return { kind: "invalid" };

  const raw = segments[0] ?? "";
  // A strict decimal without a leading zero. `Number()` would accept " 2", "1e3",
  // "1.5" and "0x2" — all of which arrived as 200s before.
  if (!/^[1-9][0-9]*$/.test(raw)) return { kind: "invalid" };

  const page = Number(raw);
  if (page > MAX_PAGE) return { kind: "invalid" };
  return page === 1 ? { kind: "alias" } : { kind: "page", page };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm -F @viu/emporix-examples-next-server-first test
```

Expected: PASS, and the six existing suites stay green.

- [ ] **Step 5: Commit**

```bash
git add examples/next-server-first/app/lib/page-segment.ts examples/next-server-first/tests/page-segment.test.ts
git commit -m "feat(examples): add a strict page-segment parser"
```

---

### Task 3.2: Wire the category page

**Files:**
- Modify: `examples/next-server-first/app/[lang]/category/[id]/[[...page]]/page.tsx`

**Interfaces:**
- Consumes: `parsePageSegment` from Task 3.1; `permanentRedirect`, `notFound` from `next/navigation`; `alternatesFor`, `categoryIndex`, `isLanguage` — already imported by this file.
- Produces: nothing later tasks depend on. PR 4 Task 4.3 edits the same file and expects the parser call to already be there.

- [ ] **Step 1: Add the imports**

`notFound` is already imported. Add `permanentRedirect` to it and the parser:

```ts
import { notFound, permanentRedirect } from "next/navigation";
import { parsePageSegment } from "../../../../lib/page-segment";
```

- [ ] **Step 2: Use the parser in `generateMetadata`**

Replace the page-number line in `generateMetadata`:

```ts
  const { lang, id, page: segments } = await params;
  if (!isLanguage(lang)) return {};
  // An alias or an invalid segment never renders, so it gets no metadata either —
  // the redirect and the 404 in the page body below own those two cases.
  const parsed = parsePageSegment(segments);
  if (parsed.kind !== "page") return {};
  const page = parsed.page;
```

The rest of `generateMetadata` is unchanged: `page > 1` still decides the title and the
suffix, and it is now guaranteed to be a real page number.

- [ ] **Step 3: Use the parser in the page body**

Replace the `const page = Math.max(...)` block and its comment:

```ts
  const { lang, id, page: segments } = await params;
  // Three outcomes, three HTTP answers — see `lib/page-segment.ts`. Measured
  // 2026-08-06, all nine of these shapes answered 200 before: `/1`, `/0`, `/abc`,
  // `/-1`, `/01`, `/2/3/4`, `/99999` and two more.
  //
  // `/1` redirects rather than 404s: it renders exactly what the bare URL renders,
  // it is a URL a human would type, and another site may already link it.
  const parsed = parsePageSegment(segments);
  if (parsed.kind === "invalid") notFound();
  if (parsed.kind === "alias") {
    permanentRedirect(`/${lang}/category/${encodeURIComponent(id)}`);
  }
  const page = parsed.page;
```

- [ ] **Step 4: Turn the soft 404 into a real one**

Replace the empty-products branch. The old code printed «Nothing on page N» with a 200;
that branch goes away entirely:

```tsx
      {products.items.length === 0 ? (
        children.length > 0 ? (
          // A pure parent category holds only subcategories, so the tiles above are
          // the answer — an «empty» notice would be wrong there.
          null
        ) : (
          <p className="muted">No products in this category.</p>
        )
      ) : (
```

and above the `return`, after `products` is fetched:

```ts
  // A page past the last one is not a document. It used to answer 200 with «Nothing on
  // page N» — a soft 404, and since #241 one that nominated itself as its own
  // canonical. `page > 1` matters: an empty page 1 is an empty category, which is a
  // real page with a real answer.
  if (products.items.length === 0 && page > 1) notFound();
```

- [ ] **Step 5: Build and probe every shape**

```bash
cd examples/next-server-first && pnpm build && npx next start -p 3300
```

Write this to a file and run it with `zsh` — a `for` loop inline in a compound shell
command gets refused by some sandboxes, and one refusal in the middle of a probe is worse
than four extra lines:

```bash
B=http://localhost:3300/de/category/2c3f70c7-918b-5b2b-95ba-fc378011c170
curl -s -o /dev/null -w 'bare      %{http_code}  %{redirect_url}\n' "$B"
curl -s -o /dev/null -w '/1        %{http_code}  %{redirect_url}\n' "$B/1"
curl -s -o /dev/null -w '/0        %{http_code}\n' "$B/0"
curl -s -o /dev/null -w '/99999    %{http_code}\n' "$B/99999"
curl -s -o /dev/null -w '/abc      %{http_code}\n' "$B/abc"
curl -s -o /dev/null -w '/2/3/4    %{http_code}\n' "$B/2/3/4"
curl -s -o /dev/null -w '/-1       %{http_code}\n' "$B/-1"
curl -s -o /dev/null -w '/01       %{http_code}\n' "$B/01"
```

Expected:

| segment | status |
|---|---|
| bare | 200 |
| `/1` | **308**, `redirect_url` the bare URL |
| `/0`, `/abc`, `/2/3/4`, `/-1`, `/01`, `/99999` | **404** |

The route table still shows four `●`. `curl` does not follow the 308 without `-L`, which is
what makes `redirect_url` readable.

- [ ] **Step 6: Verify a real page 2 still works**

`2c3f70c7-…` above has fewer than 25 products, so its `/2` is legitimately a 404. Three
categories on this tenant do have more than one page — measured 2026-08-06 by asking for
`pageSize: 25` across the first 400 tree nodes:

```
3c7f70b4-822f-51d8-9d3c-475f3a02779a
67bea5cc-fa72-5dd4-a2d2-7494c0663079
69cf5beb-a8e3-5e72-8bfa-2b88c2a728d1
```

```bash
P=http://localhost:3300/de/category/3c7f70b4-822f-51d8-9d3c-475f3a02779a
curl -s -o /dev/null -w 'page 2: %{http_code}\n' "$P/2"
curl -s "$P/2" | grep -oiE '<title>[^<]*</title>|rel="canonical" href="[^"]*'
```

Expected: `200`, a title ending in «page 2», and a canonical pointing at `/2` itself — the
self-canonical rule from #241, which is what makes pagination indexable rather than folded
into page 1.

- [ ] **Step 7: Commit**

```bash
git add "examples/next-server-first/app/[lang]/category/[id]/[[...page]]/page.tsx"
git commit -m "fix(examples): reject category page segments that are not pages"
```

---

### Task 3.3: Validate the variant segment, and bound the stale window

**Files:**
- Modify: `examples/next-server-first/app/[lang]/product/[id]/[[...variant]]/page.tsx`
- Modify: `examples/next-server-first/next.config.mjs`

**Interfaces:**
- Consumes: `notFound` — already imported by the product page.
- Produces: nothing later tasks depend on. PR 4 Task 4.2 edits the same page file.

- [ ] **Step 1: Validate the variant in the page body**

Replace the `chosen` / `selected` block:

```ts
  const { lang, id, variant } = await params;
  // More than one segment is not a variant URL. `/de/product/x/a/b/c` answered 200
  // before — measured 2026-08-06.
  if (variant !== undefined && variant.length > 1) notFound();
  const chosen = variant?.[0];
```

and after `children` is fetched, replacing the existing `const selected = …` line:

```ts
  let selected = children[0] ?? parent;
  if (chosen !== undefined) {
    const match = children.find((c) => (c as { id?: string }).id === chosen);
    // A variant segment that names nothing is not a document. On this tenant that is
    // *every* variant segment: 300 products swept 2026-08-03, every one
    // `productType: BASIC`, so `children` is always empty. Correct rather than a
    // regression — `/de/product/x/bogus` was never a page.
    if (match === undefined) notFound();
    selected = match;
  }
```

A statement rather than `children.find(…) ?? notFound()`, although the latter type-checks
because `notFound()` returns `never`: every other guard in this file is a statement, and a
control-flow jump hidden inside a `??` is the kind of line somebody reads twice.

- [ ] **Step 2: Bound the stale window**

`examples/next-server-first/next.config.mjs`:

```js
/** @type {import('next').NextConfig} */
export default {
  /**
   * How long a stale page may still be served while it revalidates.
   *
   * Next's default is one year, and for a shop that is too long: measured, the
   * catalog routes answered `stale-while-revalidate=31532400`, so if revalidation
   * kept failing the storefront would keep serving year-old **prices**. It is not
   * hypothetical — during the metadata work a product page cached by an earlier build
   * was served for a page whose code had already changed.
   *
   * Next computes `stale-while-revalidate = expireTime − revalidate`, so with the
   * routes' `revalidate = 3600` this yields 82'800 s. Measured, not read off.
   */
  expireTime: 86_400,
};
```

- [ ] **Step 3: Build and probe both**

```bash
cd examples/next-server-first && pnpm build && npx next start -p 3300
```

```bash
curl -s -D - -o /dev/null http://localhost:3300/de | grep -i cache-control
PID=$(curl -s http://localhost:3300/de | grep -oE 'href="/de/product/[^"/]*"' | head -1 | sed 's/href="//;s/"//')
curl -s -o /dev/null -w 'product        %{http_code}\n' "http://localhost:3300$PID"
curl -s -o /dev/null -w 'bogus variant  %{http_code}\n' "http://localhost:3300$PID/bogus"
curl -s -o /dev/null -w 'deep variant   %{http_code}\n' "http://localhost:3300$PID/a/b/c"
```

Expected: `Cache-Control: s-maxage=3600, stale-while-revalidate=82800`; product 200; both
variant URLs **404**. Build table shows `Expire: 1d` on the two prerendered routes.

- [ ] **Step 4: Commit**

```bash
git add "examples/next-server-first/app/[lang]/product/[id]/[[...variant]]/page.tsx" examples/next-server-first/next.config.mjs
git commit -m "fix(examples): reject unknown variant segments and bound the stale window"
```

---

### Task 3.4: README, full verification, PR 3

**Files:**
- Modify: `examples/next-server-first/README.md`

- [ ] **Step 1: Extend «What a crawler gets»**

Insert after the «Per-page metadata» subsection, before `## Checkout`:

```markdown
### One URL per document

Twelve URL shapes answered **200** before this — measured 2026-08-06, each of them also
buying its own ISR cache entry:

| shape | before | now |
|---|---|---|
| `…/category/x/1` | 200, duplicate of page 1 | **308** to the bare URL |
| `…/category/x/0`, `/abc`, `/-1`, `/01`, `/2/3/4` | 200, rendered page 1 | **404** |
| `…/category/x/99999` | 200, «Nothing on page N», self-canonical | **404** |
| `…/product/x/bogus`, `/a/b/c` | 200, duplicate of the product | **404** |

`lib/page-segment.ts` decides all of it in one place and returns three outcomes rather
than a number, because the three need different HTTP answers: a page renders, the page-1
alias redirects, anything else 404s. `/1` redirects rather than 404s because it renders
exactly what the bare URL renders and another site may already link it.

The page number is bounded at 10'000. Not caution: measured, `pageNumber: 99999` answers
200 with an empty list, but 1e15 and above make Emporix answer `400` — which would
surface as a 500, the same class of bug the language guard fixed.

The stale window is now a day instead of a year. Next computes
`stale-while-revalidate = expireTime − revalidate`, so `expireTime: 86400` with the
routes' hourly `revalidate` yields 82'800 s. The default 1 year meant a storefront whose
revalidation kept failing would keep serving year-old prices.
```

- [ ] **Step 2: Full verification**

```bash
pnpm -F @viu/emporix-examples-next-server-first test
pnpm -F @viu/emporix-examples-next-server-first typecheck
cd examples/next-server-first && pnpm build
```

Expected: all suites green including `page-segment.test.ts`; typecheck clean; four `●`
catalog routes with `Expire: 1d`.

- [ ] **Step 3: Commit, push, open the PR**

```bash
git add examples/next-server-first/README.md
git commit -m "docs(examples): document the url discipline"
git push origin fix/example-url-discipline
```

Push over SSH — the `gh` token works for API calls but is rejected for git. Open against
`main` with `gh pr create`. Body: the twelve-shape before/after table, the measured Emporix
`pageNumber` bound, the `swr = expireTime − revalidate` arithmetic, and the note that
validating the variant means every variant URL 404s on this tenant because no product has
children. **Do not merge.**

---

# PR 4 — Structured data and the full sitemap

Branch `feat/example-structured-data` off `main` once PR 3 is merged; off PR 3 otherwise,
and say so in the PR body.

### Task 4.1: The JSON-LD module

**Files:**
- Create: `examples/next-server-first/app/lib/json-ld.ts`
- Test: `examples/next-server-first/tests/json-ld.test.ts`

**Interfaces:**
- Consumes: nothing. **No SDK types and no server imports on purpose** — that is what keeps it vitest-loadable and what would make it promotable to `@viu/emporix-sdk-next` unchanged.
- Produces:
  ```ts
  export function productJsonLd(input: {
    name: string;
    url: string;
    description?: string;
    sku?: string;
    price?: { amount: number; currency: string };
  }): Record<string, unknown>;

  export function breadcrumbJsonLd(items: { name: string; url: string }[]): Record<string, unknown>;

  export function jsonLdScript(value: unknown): string;
  ```
  Tasks 4.2 and 4.3 map Emporix shapes to those inputs at the page, not here.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { breadcrumbJsonLd, jsonLdScript, productJsonLd } from "../app/lib/json-ld";

describe("productJsonLd", () => {
  it("emits the fields a Product needs", () => {
    const ld = productJsonLd({
      name: "Just-in-Time Access",
      url: "https://shop.test/de/product/abc",
      description: "Time-boxed elevation.",
      sku: "iam-jit-access",
      price: { amount: 1, currency: "CHF" },
    });
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("Product");
    expect(ld.name).toBe("Just-in-Time Access");
    expect(ld.sku).toBe("iam-jit-access");
    expect(ld.offers).toEqual({
      "@type": "Offer",
      price: 1,
      priceCurrency: "CHF",
      url: "https://shop.test/de/product/abc",
    });
  });

  it("omits offers when there is no price", () => {
    // Most of this tenant's catalogue has no price in the main/CHF/CH context, and a
    // Product without an Offer is valid markup. An Offer with a made-up price is not.
    const ld = productJsonLd({ name: "X", url: "https://shop.test/de/product/x" });
    expect(ld.offers).toBeUndefined();
  });

  it("omits description and sku rather than emitting empty strings", () => {
    const ld = productJsonLd({ name: "X", url: "u", description: "", sku: "" });
    expect("description" in ld).toBe(false);
    expect("sku" in ld).toBe(false);
  });

  it("never claims availability", () => {
    // Measured 2026-08-06: the tenant has no availability records —
    // `availability.get` 404s and `getMany` synthesises `available: false` for every
    // priced product. Emitting InStock would be a lie and OutOfStock would contradict
    // a working «Add to cart» button.
    const ld = productJsonLd({
      name: "X",
      url: "u",
      price: { amount: 1, currency: "CHF" },
    });
    expect(JSON.stringify(ld)).not.toContain("availability");
  });
});

describe("breadcrumbJsonLd", () => {
  it("numbers the positions from one", () => {
    const ld = breadcrumbJsonLd([
      { name: "Categories", url: "https://shop.test/de/categories" },
      { name: "Building", url: "https://shop.test/de/category/b" },
    ]);
    expect(ld["@type"]).toBe("BreadcrumbList");
    expect(ld.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Categories", item: "https://shop.test/de/categories" },
      { "@type": "ListItem", position: 2, name: "Building", item: "https://shop.test/de/category/b" },
    ]);
  });
});

describe("jsonLdScript", () => {
  it("escapes a closing script tag out of the payload", () => {
    // The one test that matters here. Tenant text goes into a <script> body, so a
    // description containing `</script>` would end the element and everything after
    // it would be parsed as HTML. Measured 2026-08-06: 0 of 200 descriptions on this
    // tenant contain `<` at all — which is exactly why an unescaped implementation
    // would pass every test written against today's data.
    const out = jsonLdScript({ description: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("</script>");
    expect(out).toContain("\\u003c");
  });

  it("still round-trips as JSON", () => {
    const value = { a: "<b>", c: [1, 2] };
    expect(JSON.parse(jsonLdScript(value))).toEqual(value);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm -F @viu/emporix-examples-next-server-first test
```

Expected: FAIL — `Cannot find module '../app/lib/json-ld'`.

- [ ] **Step 3: Write the module**

```ts
/**
 * Schema.org output for the two catalog pages that have something to say.
 *
 * **No SDK types and no server imports**, and both are deliberate. It keeps the module
 * loadable by vitest, and it is the shape that would let this move into
 * `@viu/emporix-sdk-next` unchanged if a second server-rendered consumer ever wants
 * it. Today there is one — this demo — so it stays here. Mapping Emporix shapes onto
 * these inputs happens at the page.
 *
 * What is deliberately absent:
 *
 * - **`image`** — `media` is `[]` on every product sampled on this tenant.
 * - **`availability`** — measured 2026-08-06, the tenant carries no availability
 *   records at all: `availability.get` answers 404 and `getMany` synthesises
 *   `available: false` for every priced product. `InStock` would be invented and
 *   `OutOfStock` would contradict an «Add to cart» button that demonstrably works.
 *   A tenant that does keep records should call `availability.getMany` — one batched
 *   request for a whole grid — and pass the result in.
 * - **`gtin`/`mpn`** — absent from the product shape. `code` is the merchant code and
 *   is what `sku` gets.
 */

/** A Product, with an Offer only when there is a real price. */
export function productJsonLd(input: {
  name: string;
  url: string;
  description?: string;
  sku?: string;
  price?: { amount: number; currency: string };
}): Record<string, unknown> {
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: input.name,
    url: input.url,
  };
  // Empty strings are omitted rather than emitted: `description: ""` is a claim that
  // the product has an empty description, which is not the same as not knowing.
  if (input.description !== undefined && input.description !== "") {
    ld.description = input.description;
  }
  if (input.sku !== undefined && input.sku !== "") ld.sku = input.sku;
  if (input.price !== undefined) {
    ld.offers = {
      "@type": "Offer",
      price: input.price.amount,
      priceCurrency: input.price.currency,
      url: input.url,
    };
  }
  return ld;
}

/** A BreadcrumbList. `items` is in document order, ancestors first. */
export function breadcrumbJsonLd(
  items: { name: string; url: string }[],
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  };
}

/**
 * Serialize for a `<script type="application/ld+json">` body.
 *
 * `JSON.stringify` alone is **not** safe here. The payload carries merchant text, and
 * a description containing `</script>` would close the element — everything after it
 * would then be parsed as HTML. `<` is valid inside a JSON string and decodes
 * back to `<`, so escaping every `<` costs nothing and closes the hole without
 * needing to know which sequences matter.
 *
 * Measured 2026-08-06: 0 of 200 descriptions on this tenant contain `<` at all. That
 * is the reason this is a function with a test rather than an inline
 * `JSON.stringify` — the unescaped version passes everything today.
 */
export function jsonLdScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm -F @viu/emporix-examples-next-server-first test
```

Expected: PASS, all suites green.

- [ ] **Step 5: Commit**

```bash
git add examples/next-server-first/app/lib/json-ld.ts examples/next-server-first/tests/json-ld.test.ts
git commit -m "feat(examples): add schema.org builders for product and breadcrumb"
```

---

### Task 4.2: Emit the Product script

**Files:**
- Modify: `examples/next-server-first/app/[lang]/product/[id]/[[...variant]]/page.tsx`

**Interfaces:**
- Consumes: `productJsonLd`, `jsonLdScript` from Task 4.1; `absoluteUrl` from `app/lib/site-url.ts`; `name`, `description`, `price`, `selectedId` — all already computed in this page's body.
- Produces: nothing.

- [ ] **Step 1: Add the imports**

```ts
import { jsonLdScript, productJsonLd } from "../../../../lib/json-ld";
import { absoluteUrl } from "../../../../lib/site-url";
```

- [ ] **Step 2: Build the payload after `description` and `images`**

```ts
  // The canonical URL, not the requested one: a variant page canonicalises to its
  // parent (#241), and structured data that disagreed with the canonical would be a
  // second, contradicting claim about the same document.
  const canonical = absoluteUrl(`/${lang}/product/${encodeURIComponent(id)}`);
  const ld = productJsonLd({
    name,
    url: canonical,
    description,
    // `code` is the merchant code — `iam-jit-access` on this tenant. There is no
    // `gtin`, `sku` or `ean` field on an Emporix product.
    sku: typeof (parent as { code?: unknown }).code === "string"
      ? (parent as { code: string }).code
      : undefined,
    ...(price !== undefined
      ? { price: { amount: price.amount, currency: price.currency } }
      : {}),
  });
```

- [ ] **Step 3: Render it inside the returned `<main>`**

As the first child of `<main>`, before `<Sheet>`:

```tsx
      <script
        type="application/ld+json"
        // `jsonLdScript`, not `JSON.stringify`: merchant text in a script body needs
        // `<` escaped or a description containing `</script>` closes the element.
        dangerouslySetInnerHTML={{ __html: jsonLdScript(ld) }}
      />
```

- [ ] **Step 4: Build and verify the payload**

```bash
cd examples/next-server-first && pnpm build && npx next start -p 3300
PID=$(curl -s http://localhost:3300/de | grep -oE 'href="/de/product/[^"/]*"' | head -1 | sed 's/href="//;s/"//')
curl -s "http://localhost:3300$PID" > /tmp/p.html
grep -o 'application/ld+json' /tmp/p.html | wc -l
python3 - <<'PY'
import re, json, pathlib
html = pathlib.Path("/tmp/p.html").read_text()
for m in re.finditer(r'<script type="application/ld\+json">(.*?)</script>', html, re.S):
    print(json.dumps(json.loads(m.group(1)), indent=2, ensure_ascii=False))
PY
```

Expected: one script, and the parsed JSON shows `@type: Product`, the real product name,
a `sku` like `iam-jit-access`, an `offers` block with `price` and `priceCurrency: "CHF"`,
**no** `availability`, **no** `image`. It must parse — if `json.loads` throws, the
escaping is wrong.

- [ ] **Step 5: Verify the escaping survives a real render**

```bash
grep -c '\\u003c' /tmp/p.html
```

Expected: 0 on this tenant, because no description contains `<`. That is not a failure —
it is the measured baseline, and the unit test is what proves the escape works. Say this
in the PR rather than claiming the escape was verified end to end.

- [ ] **Step 6: Commit**

```bash
git add "examples/next-server-first/app/[lang]/product/[id]/[[...variant]]/page.tsx"
git commit -m "feat(examples): emit product structured data"
```

---

### Task 4.3: Emit the BreadcrumbList script

**Files:**
- Modify: `examples/next-server-first/app/[lang]/category/[id]/[[...page]]/page.tsx`

**Interfaces:**
- Consumes: `breadcrumbJsonLd`, `jsonLdScript` from Task 4.1; `absoluteUrl`; `entry.path` and `entry.label` from `categoryIndex`, already in this page's body.
- Produces: nothing.

- [ ] **Step 1: Add the imports**

```ts
import { breadcrumbJsonLd, jsonLdScript } from "../../../../lib/json-ld";
import { absoluteUrl } from "../../../../lib/site-url";
```

- [ ] **Step 2: Build the payload after `entry` is resolved**

```ts
  // The same trail the visible breadcrumb renders, from the same prebuilt index — so
  // the markup and the page cannot drift apart. `/categories` leads it because that
  // is where the visible trail starts.
  //
  // Only on page 1. On page 3 the trail would describe a document the crumb does not
  // point at, and a paginated page self-canonicalises (#241) rather than folding into
  // page 1.
  const crumbs = breadcrumbJsonLd([
    { name: "Categories", url: absoluteUrl(`/${lang}/categories`) },
    ...entry.path.map((a) => ({
      name: a.label,
      url: absoluteUrl(`/${lang}/category/${encodeURIComponent(a.id)}`),
    })),
    { name: entry.label, url: absoluteUrl(`/${lang}/category/${encodeURIComponent(id)}`) },
  ]);
```

- [ ] **Step 3: Render it as the first child of `<main>`, page 1 only**

```tsx
      {page === 1 ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdScript(crumbs) }}
        />
      ) : null}
```

- [ ] **Step 4: Build and verify on a nested category**

```bash
cd examples/next-server-first && pnpm build && npx next start -p 3300
CAT=$(curl -s http://localhost:3300/sitemap.xml | grep -oE '/de/category/[0-9a-f-]+' | sed -n '800p')
curl -s "http://localhost:3300$CAT" > /tmp/c.html
python3 - <<'PY'
import re, json, pathlib
html = pathlib.Path("/tmp/c.html").read_text()
for m in re.finditer(r'<script type="application/ld\+json">(.*?)</script>', html, re.S):
    print(json.dumps(json.loads(m.group(1)), indent=2, ensure_ascii=False))
PY
```

Expected: a `BreadcrumbList` whose `itemListElement` starts at position 1 with
«Categories» and ends with the category's own label — for the sitemap's 800th entry that
was «Voltage Transformers» under «Building & Construction / Electrical Equipment &
Supplies / Power Conditioning» when this plan was written. Every `item` is absolute.

Then confirm page 2 has none:

```bash
curl -s "http://localhost:3300$CAT/2" | grep -c 'application/ld+json'
```

Expected: 0 — or a 404 for that category, which is also correct after PR 3.

- [ ] **Step 5: Commit**

```bash
git add "examples/next-server-first/app/[lang]/category/[id]/[[...page]]/page.tsx"
git commit -m "feat(examples): emit breadcrumb structured data"
```

---

### Task 4.4: Put the products in the sitemap

**Files:**
- Modify: `examples/next-server-first/app/sitemap.ts`

**Interfaces:**
- Consumes: `getEmporixClient` from `@viu/emporix-sdk-next`, `auth` from `@viu/emporix-sdk`, `siteContext` from `app/lib/site-context.ts`, `TIMEOUTS` from `app/emporix.ts`; `absoluteUrl`, `LANGUAGES`, `categoryIndex` — already imported by this file.
- Produces: nothing.

- [ ] **Step 1: Add the walk**

Above the default export:

```ts
/**
 * Every product id, once, with the timestamp the sitemap reports.
 *
 * **One walk for both languages**, because a product URL differs only in its prefix —
 * the ids and `modifiedAt` are language-independent. Walking per language would double
 * the Emporix calls for identical data.
 *
 * Measured 2026-08-06: 876 products, so five pages of 200. Each page is a tagged GET
 * (`emporix:products`), so the walk is cached for an hour and the product webhook
 * invalidates it along with everything else.
 *
 * The cap is a real limit, not a formality: a sitemap holds at most 50'000 URLs, and
 * with two languages plus the categories that is roughly 23'000 products. Hitting it
 * means it is time for `generateSitemaps` and shards, so it says so out loud rather
 * than silently truncating.
 */
const PAGE = 200;
const MAX_PRODUCTS = 20_000;

async function allProducts(): Promise<{ id: string; modifiedAt?: string }[]> {
  const client = getEmporixClient({
    context: await siteContext(DEFAULT_LANGUAGE),
    timeouts: TIMEOUTS,
  });
  const out: { id: string; modifiedAt?: string }[] = [];
  for (let page = 1; out.length < MAX_PRODUCTS; page += 1) {
    // `undefined` for auth, matching `categoryTree` in this app: the SDK defaults to
    // an anonymous context, and the tagged client is the one holding the token.
    const res = await client.products.list({ pageSize: PAGE, pageNumber: page }, undefined);
    for (const p of res.items) {
      const id = (p as { id?: string }).id;
      if (id === undefined || id === "") continue;
      const modifiedAt = (p as { metadata?: { modifiedAt?: string } }).metadata?.modifiedAt;
      out.push(modifiedAt !== undefined ? { id, modifiedAt } : { id });
    }
    if (res.items.length < PAGE) return out;
  }
  console.warn(
    `sitemap: stopped at ${MAX_PRODUCTS} products. Shard with generateSitemaps — one file holds 50'000 URLs.`,
  );
  return out;
}
```

with the added imports:

```ts
import { getEmporixClient } from "@viu/emporix-sdk-next";
import { DEFAULT_LANGUAGE, LANGUAGES } from "./lib/languages";
import { siteContext } from "./lib/site-context";
import { TIMEOUTS } from "./emporix";
```

`LANGUAGES` is already imported from `./lib/languages` — extend that line rather than
adding a second import from the same module, which is a lint error.

- [ ] **Step 2: Use it in the default export**

```ts
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [];
  // Outside the language loop on purpose — see `allProducts`.
  const products = await allProducts();

  for (const lang of LANGUAGES) {
    const { byId } = await categoryIndex(lang);
    entries.push(
      { url: absoluteUrl(`/${lang}`), changeFrequency: "daily", priority: 1 },
      { url: absoluteUrl(`/${lang}/categories`), changeFrequency: "weekly", priority: 0.8 },
    );
    for (const id of Object.keys(byId)) {
      entries.push({
        url: absoluteUrl(`/${lang}/category/${encodeURIComponent(id)}`),
        changeFrequency: "weekly",
        priority: 0.6,
      });
    }
    for (const p of products) {
      entries.push({
        url: absoluteUrl(`/${lang}/product/${encodeURIComponent(p.id)}`),
        ...(p.modifiedAt !== undefined ? { lastModified: new Date(p.modifiedAt) } : {}),
        changeFrequency: "weekly",
        priority: 0.7,
      });
    }
  }

  return entries;
}
```

- [ ] **Step 3: Build and count**

```bash
cd examples/next-server-first && pnpm build && npx next start -p 3300
curl -s http://localhost:3300/sitemap.xml -o /tmp/sm.xml -w 'sitemap %{http_code} %{size_download}B\n'
echo "urls:     $(grep -c '<url>' /tmp/sm.xml)"
echo "products: $(grep -c '/product/' /tmp/sm.xml)"
echo "lastmod:  $(grep -c '<lastmod>' /tmp/sm.xml)"
```

Expected on this tenant: `200`, 5'018 URLs — `2 × (2 + 1631 + 876)` — of which 1'752 are
products, and a `<lastmod>` on each of those. If the product count is 0, the walk failed;
check `.env.local` before changing code.

- [ ] **Step 4: Verify the walk is cached, not repeated per request**

Start with the call probe from `docs/superpowers/plans/2026-08-06-seo-language-guard-and-metadata.md`:

```bash
rm -f /tmp/emporix-calls.log
curl -s -o /dev/null http://localhost:3300/sitemap.xml
sleep 2 && sort /tmp/emporix-calls.log | uniq -c
```

Expected: empty, or at most the anonymous login — the five product pages and the tree
come from the tag cache the build already filled. If five `GET …/products` show up on
every request, the tagged fetch is not being used and that is worth reporting rather than
working around.

- [ ] **Step 5: Commit**

```bash
git add examples/next-server-first/app/sitemap.ts
git commit -m "feat(examples): add the products to the sitemap"
```

---

### Task 4.5: README, full verification, PR 4

**Files:**
- Modify: `examples/next-server-first/README.md`

- [ ] **Step 1: Extend the SEO section**

```markdown
### Structured data

The product page emits a `Product`, a nested `Offer` when there is a price, and the
category page a `BreadcrumbList` built from the same prebuilt index the visible
breadcrumb uses — so the markup cannot drift from the page. `lib/json-ld.ts` carries no
SDK types and no server imports, which is what keeps it testable and what would let it
move into `@viu/emporix-sdk-next` unchanged if a second server-rendered consumer wants
it. Today there is one, so it stays here.

**What it deliberately does not claim.** No `availability`: measured 2026-08-06, this
tenant carries no availability records at all — `availability.get` answers 404 and
`getMany` synthesises `available: false` for every priced product. `InStock` would be
invented, `OutOfStock` would contradict an «Add to cart» button that works, and
structured data that disagrees with the page is worse than none. A tenant that keeps
records should call `availability.getMany` — one batched request per grid — and pass the
result in. No `image` either: `media` is `[]` on every product on this tenant. `sku`
comes from `code`, because an Emporix product has no `gtin`, `sku` or `ean` field.

**The payload is escaped, not just stringified.** Merchant text goes into a `<script>`
body, so a description containing `</script>` would close the element and everything
after it would be parsed as HTML. `jsonLdScript` replaces every `<` with `<`.
Measured: 0 of 200 descriptions on this tenant contain `<` — which is exactly why the
unescaped version would have passed every test written against today's data, and why
this one has a test that feeds it a closing script tag.

The sitemap now holds the products too: 5'018 URLs on this tenant (two languages ×
2 entry pages + 1'631 categories + 876 products), each product with the `modifiedAt`
from its metadata. One catalogue walk serves both languages, because a product URL
differs only in its prefix. The walk stops at 20'000 products and says so — one sitemap
file holds 50'000 URLs, and past that it needs `generateSitemaps` and shards.
```

- [ ] **Step 2: Full verification**

```bash
pnpm -F @viu/emporix-examples-next-server-first test
pnpm -F @viu/emporix-examples-next-server-first typecheck
cd examples/next-server-first && pnpm build
```

Expected: all suites green including `json-ld.test.ts`; typecheck clean; the four `●`
catalog routes unchanged.

- [ ] **Step 3: Validate both payloads once more, parsed rather than grepped**

Re-run the `python3` snippets from Tasks 4.2 and 4.3. A payload that greps right but does
not parse is the failure mode this whole module is defending against.

- [ ] **Step 4: Commit, push, open the PR**

```bash
git add examples/next-server-first/README.md
git commit -m "docs(examples): document the structured data"
git push origin feat/example-structured-data
```

Body: the two payloads as parsed JSON, the availability measurement and why the field is
absent, the escaping argument with the 0-of-200 number, and the sitemap counts. Note that
`pr-check.yml` only runs on PRs based on `main`, so a stacked PR gets the changeset check
alone. **Do not merge.**

---

## What these two PRs deliberately do not do

- **`<html lang>`.** Still `en`, with the language on a wrapper inside. Moves with the
  session routes going under `/[lang]/…` — option B in
  `docs/superpowers/specs/2026-08-05-language-write-from-proxy.md`.
- **`Set-Cookie` on cacheable catalog HTML.** Same dependency.
- **The redirect hop on `/` and `/categories`.** Same dependency.
- **`next/image`.** No product on this tenant has an image, so `images.remotePatterns`
  would be unverifiable configuration.
- **Availability in structured data.** Blocked on the tenant, not on us. See above.
- **Sitemap sharding.** 5'018 URLs against a 50'000 limit. The cap warns when that
  changes.
- **`next-app-router`.** Its own example and its own PR: six of six routes dynamic because
  the root layout reads cookies, and a product `<h1>` that renders the id because
  `typeof data.name === "string"` is false for a locale map.
