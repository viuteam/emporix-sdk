# Catalog ISR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Status: shipped** in [#221](https://github.com/viuteam/emporix-sdk/pull/221).
> The plan stays as a rationale document — the order of the three blockers
> and the finding about `generateStaticParams` are what saves time next time.
> Deviations from the plan are recorded below under «Learned while
> building».

**Goal:** Render the four catalog routes of `examples/next-server-first` statically and cache them via ISR, so that at 1'000 CCU roughly 60 % of page views no longer reach the Node process at all.

**Architecture:** Two things make every route dynamic today, and both have to go: the language comes from a cookie (`app/lib/site-context.ts:53`) and the header reads the session (`app/components/header.tsx:20-21`). The language moves into a `[lang]` route segment, the header becomes a client component that loads the personalized part through its own route handler. After that, `export const revalidate` and `generateStaticParams` take effect.

**Tech Stack:** Next 16.2.12 App Router (Node runtime), TypeScript, Vitest.

## Global Constraints

- **No `experimental.cacheComponents`.** In Next 16.2.12, `experimental.ppr` is deprecated and has been folded into `cacheComponents` — still experimental. A reference storefront that others copy does not rest its caching story on an experimental flag. Everything here runs on stable Next.
- No Emporix token in the browser. A fetch against **our own** route handlers is allowed and already exists (`app/api/emporix/[...path]/route.ts`).
- Commitlint: scope from the allowlist (`examples` fits), first word lowercase.
- A changeset is required (the gate runs unconditionally), even when only `examples/**` changes — the example packages are `ignore`d, but the gate checks that a changeset exists.
- Verification without a load test: the output of `next build` is the proof. It marks every route `○` (static), `●` (SSG) or `ƒ` (dynamic).

## Starting Point and Goal

| Route | Today | After this plan |
|---|---|---|
| `/` | ƒ dynamic | Redirect to `/de` |
| `/[lang]` | — | ● ISR, `revalidate 3600` |
| `/[lang]/categories` | ƒ (`/categories`) | ● ISR |
| `/[lang]/category/[id]` | ƒ | ƒ→ISR on demand (`dynamicParams`) |
| `/[lang]/product/[id]` | ƒ | ƒ→ISR on demand |
| `/search`, `/cart`, `/checkout`, `/account/*`, `/login` | ƒ | ƒ — unchanged and correct |

## File Structure

| File | Responsibility |
|---|---|
| `app/[lang]/layout.tsx` | **new.** Owns the `lang` parameter, `generateStaticParams`, validates against `LANGUAGES`. |
| `app/[lang]/page.tsx`, `categories/page.tsx`, `category/[id]/page.tsx`, `product/[id]/page.tsx` | **moved.** Take `lang` from the params instead of from the cookie. |
| `app/page.tsx` | **replaced.** Static redirect to the default language. |
| `app/components/header.tsx` | **client component.** No server cookie read any more; derives the catalog links from `usePathname()`. |
| `app/components/session-nav.tsx` | **new, client.** Fetches `{ cartCount, loggedIn }` from our own API. |
| `app/api/session/nav/route.ts` | **new.** Reads the session server-side, returns two fields, `no-store`. |
| `app/lib/site-context.ts` | `siteContext(lang?)` — catalog routes pass the URL language in, session routes keep reading the cookie. |
| `app/components/product-grid.tsx` | gets `lang` as a prop for the product links. |

---

### Task 1: Language from the URL instead of from the cookie

**Files:**
- Create: `app/[lang]/layout.tsx`
- Modify: `app/lib/site-context.ts`
- Test: `examples/next-server-first/tests/lang.test.ts`

**Interfaces:**
- Produces: `LANGUAGES: readonly ["en","de"]` (exists), `DEFAULT_LANGUAGE = "de"`, `isLanguage(x: string): x is Language`, `siteContext(lang?: string)`.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_LANGUAGE, isLanguage } from "../app/lib/languages";

describe("isLanguage", () => {
  it("accepts what the tenant offers", () => {
    expect(isLanguage("de")).toBe(true);
    expect(isLanguage("en")).toBe(true);
  });
  it("rejects anything else, including case variants", () => {
    // A static param is attacker-controlled: /xx/category/… must 404, not render.
    expect(isLanguage("fr")).toBe(false);
    expect(isLanguage("DE")).toBe(false);
    expect(isLanguage("")).toBe(false);
  });
  it("defaults to the tenant's default language", () => {
    expect(DEFAULT_LANGUAGE).toBe("de");
  });
});
```

- [ ] **Step 2: Confirm the failure** — `npx vitest run tests/lang.test.ts`, module missing.

- [ ] **Step 3: Create `app/lib/languages.ts`**

Pure constants without server imports, so that vitest can load them (the same separation as `category-walk.ts`).

- [ ] **Step 4: `siteContext(lang?)`** — widen the signature, cookie read only as a fallback.

- [ ] **Step 5: Tests green, commit.**

---

### Task 2: Header without a server session

The blocker for every static route. After this task, nothing in the render path of a catalog page reads cookies any more.

**Files:**
- Create: `app/api/session/nav/route.ts`, `app/components/session-nav.tsx`
- Modify: `app/components/header.tsx`, `app/components/language-switcher.tsx`

- [ ] **Step 1: Route handler** — reads `emporixSessionHandle({readOnly:true})`, returns `{ cartCount, loggedIn }`, header `Cache-Control: no-store`.
- [ ] **Step 2: `SessionNav`** as a client component with a `useEffect` fetch and a fallback without layout shift.
- [ ] **Step 3: `Header`** onto `"use client"`, catalog links from `usePathname()`.
- [ ] **Step 4: `LanguageSwitcher`** moved from a server action to links — still writes the cookie through the handler, so that session routes follow the URL.
- [ ] **Step 5: `pnpm dev`, check the header, commit.**

---

### Task 3: Move the catalog routes and enable ISR

**Files:**
- Move: four pages under `app/[lang]/`
- Modify: all internal catalog links (inventory below), `app/page.tsx` as a redirect

Affected links: `page.tsx:48,53`, `categories/page.tsx:32`, `category/[id]/page.tsx:74,80,110`, `product/[id]/page.tsx:72,111`, `components/product-grid.tsx:32`, `components/header.tsx:30,52`, `cart/page.tsx:23`, `checkout/page.tsx:14`, `checkout/done/page.tsx:20`.

- [ ] **Step 1: Move the pages, pass `params.lang` through.**
- [ ] **Step 2: Set `revalidate` and `generateStaticParams`.**
- [ ] **Step 3: Prefix the links.**
- [ ] **Step 4: `next build` — proof that the routes are `●`/`○`.**
- [ ] **Step 5: Commit.**

---

### Task 4: Docs, changeset, PR

- [ ] The example's README: why `[lang]` sits in the URL and what that has to do with caching.
- [ ] Changeset (the `examples` packages are ignored, the gate needs a file all the same).
- [ ] PR against `main`, separate from the performance-plan PR.

## What this plan does not do

The session routes (`/cart`, `/checkout`, `/account/*`) stay dynamic and cookie-based. That is not a leftover, it is correct: they are per visitor, must never be shared, and a `[lang]` prefix would gain them nothing.

The seam that follows from this — catalog reads the language from the URL, session from the cookie — is held together by the language switcher, which writes both. That is the only place where the two sources can drift apart, and it is exactly one file large.

## Learned while building

Three things turned out differently than planned, all three documented in the PR:

**`categoryTree()` read the cookie itself.** The plan saw only `siteContext()` as
a blocker. After the rework, `/[lang]/categories` was still `ƒ`, because the helper
internally called `siteContext()` without an argument. A blocker can sit in a helper
function two levels deeper — the build table says *that* a route is dynamic,
never *why*.

**`searchParams` is the same blocker as a cookie.** The plan mentioned only the
language. `?page=` and `?variant=` threw the two `[id]` routes out of static
rendering just as effectively. Both became path segments via optional catch-alls
(`[[...page]]`, `[[...variant]]`), which additionally makes the URLs linkable and
individually cacheable.

**An empty `generateStaticParams` is mandatory, not cosmetic.** After the first
two fixes, `next build` still showed the `[id]` routes as `ƒ`. The prod server
answered `Cache-Control: private, no-cache, no-store` — `revalidate = 3600`
was simply ignored. A dynamic segment without `generateStaticParams`
is rendered on demand and cached **not at all**. Returning `[]` means
«pre-render nothing, treat everything as cacheable». Found only because the build table
and the runtime header contradicted each other: the build alone would not have been enough.
