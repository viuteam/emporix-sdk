# Proxy Site Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `emporixSiteProxy(request, site, rewriteTo?)` in a new
`@viu/emporix-sdk-next/proxy` entry so a Next 16 `proxy.ts` can resolve
`siteCode`/`language` per request and have both the running render and the
browser see it.

**Architecture:** One pure function. It writes the resolved values into the
forwarded request cookies (so `emporixSession()` sees them in this render) and
as browser-readable `Set-Cookie` headers (so `createCookieStorage` seeds the
client `SiteContextProvider`). No Emporix call, no `getEmporixClient` import, no
routing policy — the storefront writes the resolver.

**Tech Stack:** TypeScript, Next 16 (`next/server`), Vitest, tsup, changesets.

**Spec:** [`../specs/2026-07-31-next-proxy-site-detection-design.md`](../specs/2026-07-31-next-proxy-site-detection-design.md)

## Global Constraints

- **Branch:** `feat/next-proxy-site-detection`, already created off `origin/main`
  (`452b557`). The spec commit `010b0a2` is already on it. Do **not** stack this
  on `fix/react-key-normalization` — `pr-check.yml` runs
  `on: pull_request: branches: [main]`, so a PR based on a feature branch never
  gets its `quality` checks and stays permanently "Expected".
- **Commitlint** (`.husky/commit-msg`): scope must be one of
  `repo, release, sdk, react, core, customer, product, category, cart, checkout,
  payment, price, media, segment, availability, auth, http, logger, deps, docs,
  examples`. There is **no** `next` scope — use `repo`. The first word after the
  scope must be a **lowercase verb**: `feat(repo): add …` ✓,
  `feat(repo): Add …` ✗.
- **Next peer range stays `^16.0.0`.** Do not widen it.
- **Cookie names come from `COOKIE_NAMES`.** Never write the string literals
  `"emporix.siteCode"` / `"emporix.language"` in `packages/next/src/`. In the
  test file they appear as expected values, which is correct — a test that
  imports the constant it asserts against tests nothing.
- **`httpOnly: false` is load-bearing and must stay explicit.** It is the
  opposite of `emporixSessionMutable` on purpose: the browser must read these
  two cookies or the storage precedence step in `SiteContextProvider` never
  fires.
- **TS strictness** (`tsconfig.base.json`): `exactOptionalPropertyTypes`,
  `noUncheckedIndexedAccess`, `verbatimModuleSyntax`,
  `moduleResolution: "bundler"`. Optional properties must be spread
  conditionally (`...(x !== undefined ? { x } : {})`), never assigned
  `undefined`. Type-only imports need the `type` keyword.
- **Build order matters locally.** `packages/next` imports
  `@viu/emporix-sdk-react/ssr`, which resolves to `packages/react/dist/ssr.js`.
  After changing `packages/react/src/ssr.ts` you MUST rebuild react before
  `packages/next` tests or typecheck will use the stale `dist/`. CI does this
  automatically (`pr-check.yml` order: build → check:dist → typecheck → lint →
  test).
- **Credentials never leave `examples/next-app-router/.env.local`.** That file
  is untracked (`.gitignore:7`, `.env.*`). Never hardcode the tenant client id
  in source, never echo it to the terminal, never paste a fragment of it into a
  commit, doc or plan.
- **Language of code comments and docs: English.** The specs and plans are
  German, the shipped source and README are English — match the surrounding
  files.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/react/src/ssr.ts` | **modify** — re-export `COOKIE_NAMES` so the next package has one source of truth for the cookie names |
| `packages/next/src/proxy.ts` | **create** — the whole feature, one exported function plus one exported interface |
| `packages/next/tests/proxy.test.ts` | **create** — ten tests |
| `packages/next/tsup.config.ts` | **modify** — third build entry |
| `packages/next/package.json` | **modify** — `"./proxy"` subpath export |
| `packages/next/README.md` | **modify** — copy-paste `proxy.ts`, the inline-matcher caveat, the `createCookieStorage` precondition, `./proxy` in the subpath list |
| `.changeset/react-cookie-names-export.md` | **create** — react minor |
| `.changeset/next-proxy-site-detection.md` | **create** — next minor |

`proxy.ts` stays a single file: one function, ~35 lines with comments. Splitting
it would be ceremony.

---

## Task 1: Export `COOKIE_NAMES` from the react ssr entry

**Files:**
- Modify: `packages/react/src/ssr.ts:5-9` (the existing re-export block)

**Interfaces:**
- Consumes: `COOKIE_NAMES` from `packages/react/src/storage/cookie-core.ts:12` —
  a `const … as const` object with exactly these eight keys:
  `customerToken, cartId, anonymousSession, siteCode, language,
  activeLegalEntityId, refreshToken, saasToken`, each mapping to
  `"emporix.<key>"`.
- Produces: `COOKIE_NAMES` importable as
  `import { COOKIE_NAMES } from "@viu/emporix-sdk-react/ssr"`. Task 2 depends on
  this.

**Why `./ssr` and not `./storage`:** `packages/react/tsup.config.ts` puts a
`"use client"` banner on the `index`, `provider`, `hooks` and `storage` entries.
A `proxy.ts` is server code and must not import a client entry. `./ssr` is the
one entry deliberately kept banner-free, guarded by
`packages/react/scripts/check-dist.mjs`.

**No new unit test in this task, deliberately.** A re-export has no behaviour to
test; asserting `COOKIE_NAMES.siteCode === "emporix.siteCode"` against an import
from `../src/cookie-core` would prove nothing about the published entry. The
real guards are `check:dist` (the banner contract) and Task 2's tests, which
consume the export through the built `dist/`.

- [ ] **Step 1: Add the re-export**

In `packages/react/src/ssr.ts`, the file currently starts with:

```ts
import type { QueryClient } from "@tanstack/react-query";
import { auth, type AuthContext, type EmporixClient } from "@viu/emporix-sdk";
import { emporixKey, siteMeta, type SiteFields } from "./hooks/internal/query-keys";

export {
  createServerStorage,
  serverAuth,
  type ServerCookieJar,
} from "./storage/server";
```

Add a second re-export directly below that block:

```ts
/**
 * The eight persisted session keys as cookie names. Exported from the server
 * entry (not `./storage`, which carries the `"use client"` banner) so server
 * code — a Next `proxy.ts`, a Route Handler — can name a cookie without
 * duplicating the literal.
 */
export { COOKIE_NAMES } from "./storage/cookie-core";
```

- [ ] **Step 2: Build react and confirm the export reached `dist/`**

Run:

```bash
pnpm -F @viu/emporix-sdk-react build
```

Then:

```bash
grep -c "COOKIE_NAMES" packages/react/dist/ssr.d.ts packages/react/dist/ssr.js
```

Expected: a non-zero count for both files.

- [ ] **Step 3: Confirm the RSC boundary contract still holds**

Run:

```bash
pnpm -F @viu/emporix-sdk-react check:dist
```

Expected: `dist "use client" banners OK`. If this fails with
`dist/ssr.js: must NOT carry "use client"`, the re-export pulled a client
module in — check that you imported from `./storage/cookie-core` and not from
`./storage/index` or `./storage/cookie`.

- [ ] **Step 4: Run the react test suite**

Run:

```bash
pnpm -F @viu/emporix-sdk-react test
```

Expected: all tests pass, count unchanged from before the edit. Adding a
re-export changes no behaviour, so a changed count means something else broke.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/ssr.ts
git commit -m "feat(react): export COOKIE_NAMES from the ssr entry" -m "Server code — a Next proxy.ts, a Route Handler — needs to name a session
cookie without duplicating the literal. The ssr entry is the one that stays
free of the \"use client\" banner, so it is the entry server code may import."
```

---

## Task 2: `emporixSiteProxy` in a new `./proxy` entry

**Files:**
- Create: `packages/next/src/proxy.ts`
- Create: `packages/next/tests/proxy.test.ts`
- Modify: `packages/next/tsup.config.ts:6` (the `entry` object)
- Modify: `packages/next/package.json` (the `exports` map, after `"./webhook"`)

**Interfaces:**
- Consumes: `COOKIE_NAMES` from `@viu/emporix-sdk-react/ssr` (Task 1);
  `NextResponse` (value) and `NextRequest` (type) from `next/server`.
- Produces:
  ```ts
  export interface EmporixSite { siteCode?: string; language?: string }
  export function emporixSiteProxy(
    request: NextRequest,
    site: EmporixSite,
    rewriteTo?: string | URL,
  ): NextResponse
  ```
  Task 3 documents exactly these names.

**Background an implementer needs:**

Four runtime facts were measured against the installed `next@16.2.12` before
this plan was written. You do not need to re-verify them, but the code depends
on all four:

1. `request.cookies.set(name, value)` is **permitted** on a `NextRequest` and
   writes the request's `cookie` header
   (`next/dist/compiled/@edge-runtime/cookies/index.js:212-217` does
   `this._headers.set("cookie", …)`). This is not obvious — `Request.headers` is
   guarded in the web standard.
2. Existing cookies in the incoming `cookie` header survive that write.
3. `NextResponse.next({ request: { headers } })` forwards the mutated headers to
   the render. `NextResponse.next({ headers })` does **not** — that sends them to
   the client. Do not confuse the two.
4. `NextResponse.rewrite(dest)` validates `dest` as an absolute URL and puts it
   in the `x-middleware-rewrite` header
   (`next/dist/server/web/spec-extension/response.js:116-118`).

- [ ] **Step 1: Write the failing test file**

Create `packages/next/tests/proxy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { emporixSiteProxy } from "../src/proxy";

// The cookie names are written out rather than imported from COOKIE_NAMES on
// purpose: a test that imports the constant it asserts against tests nothing.
const SITE = "emporix.siteCode";
const LANG = "emporix.language";

describe("emporixSiteProxy", () => {
  it("sets both cookies when the request carries none", () => {
    const request = new NextRequest("https://shop.test/de/x");
    const response = emporixSiteProxy(request, { siteCode: "main", language: "de" });
    expect(response.cookies.get(SITE)?.value).toBe("main");
    expect(response.cookies.get(LANG)?.value).toBe("de");
  });

  it("injects the values into the forwarded request cookie header", () => {
    const request = new NextRequest("https://shop.test/de/x");
    emporixSiteProxy(request, { siteCode: "main", language: "de" });
    const cookie = request.headers.get("cookie") ?? "";
    expect(cookie).toContain(`${SITE}=main`);
    expect(cookie).toContain(`${LANG}=de`);
  });

  it("writes nothing when both cookies already match", () => {
    const request = new NextRequest("https://shop.test/de/x", {
      headers: { cookie: `${SITE}=main; ${LANG}=de` },
    });
    const response = emporixSiteProxy(request, { siteCode: "main", language: "de" });
    expect(response.cookies.getAll()).toHaveLength(0);
  });

  it("sets only the field that was resolved", () => {
    const request = new NextRequest("https://shop.test/de/x");
    const response = emporixSiteProxy(request, { language: "de" });
    expect(response.cookies.getAll()).toHaveLength(1);
    expect(response.cookies.get(LANG)?.value).toBe("de");
    expect(response.cookies.get(SITE)).toBeUndefined();
  });

  it("passes the request through untouched for an empty resolution", () => {
    const request = new NextRequest("https://shop.test/x");
    const response = emporixSiteProxy(request, {});
    expect(response.cookies.getAll()).toHaveLength(0);
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("rewrites to a relative target resolved against the request url", () => {
    const request = new NextRequest("https://shop.test/de/shoes");
    const response = emporixSiteProxy(request, { language: "de" }, "/shoes");
    // Rewrite target lands in x-middleware-rewrite — see
    // next/dist/server/web/spec-extension/response.js:118. If this assertion
    // ever fails on a Next upgrade, that line is where the name moved.
    expect(response.headers.get("x-middleware-rewrite")).toBe("https://shop.test/shoes");
    expect(response.cookies.get(LANG)?.value).toBe("de");
  });

  it("rewrites to an absolute URL target", () => {
    const request = new NextRequest("https://shop.test/de/shoes");
    const response = emporixSiteProxy(
      request,
      { language: "de" },
      new URL("https://shop.test/shoes"),
    );
    expect(response.headers.get("x-middleware-rewrite")).toBe("https://shop.test/shoes");
    expect(response.cookies.get(LANG)?.value).toBe("de");
  });

  it("marks the cookie Secure only over https", () => {
    // One field only, so `get("set-cookie")` is a single unambiguous value.
    const secure = emporixSiteProxy(new NextRequest("https://shop.test/x"), {
      language: "de",
    });
    expect(secure.headers.get("set-cookie")).toContain("Secure");

    const plain = emporixSiteProxy(new NextRequest("http://shop.test/x"), {
      language: "de",
    });
    expect(plain.headers.get("set-cookie")).not.toContain("Secure");
  });

  it("never marks the site cookies HttpOnly", () => {
    // The browser-side createCookieStorage must read these, or the storage
    // precedence step in SiteContextProvider never fires.
    const response = emporixSiteProxy(new NextRequest("https://shop.test/x"), {
      language: "de",
    });
    expect(response.headers.get("set-cookie")).not.toContain("HttpOnly");
  });

  it("overwrites a cookie whose value differs", () => {
    const request = new NextRequest("https://shop.test/de/x", {
      headers: { cookie: `${LANG}=fr` },
    });
    const response = emporixSiteProxy(request, { language: "de" });
    expect(response.cookies.get(LANG)?.value).toBe("de");
    const cookie = request.headers.get("cookie") ?? "";
    expect(cookie).toContain(`${LANG}=de`);
    expect(cookie).not.toContain(`${LANG}=fr`);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm -F @viu/emporix-sdk-next exec vitest run tests/proxy.test.ts
```

Expected: the suite fails to collect with a resolution error along the lines of
`Failed to load ../src/proxy` / `Cannot find module`. All ten tests fail because
the module does not exist yet. If instead you see `emporixSiteProxy is not a
function`, the file exists but the export name is wrong.

- [ ] **Step 3: Write the implementation**

Create `packages/next/src/proxy.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_NAMES } from "@viu/emporix-sdk-react/ssr";

/**
 * The site and language a proxy resolved for one request.
 *
 * An absent field is left alone — there is no delete. Call
 * `response.cookies.delete` yourself if you need one gone.
 */
export interface EmporixSite {
  siteCode?: string;
  language?: string;
}

const ENTRIES = [
  ["siteCode", COOKIE_NAMES.siteCode],
  ["language", COOKIE_NAMES.language],
] as const;

/** One year. A site/language choice is a preference, not a session. */
const MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Persists a resolved site/language for one request, from a Next 16 `proxy.ts`.
 *
 * Writes each changed value twice, and both writes are needed:
 * - into the **forwarded request** cookies, so `emporixSession()` sees it in
 *   this very render rather than the next one;
 * - as a browser-readable **`Set-Cookie`**, so `createCookieStorage` seeds the
 *   client `SiteContextProvider` and the hydration query key matches the one
 *   the server prefetched with.
 *
 * A value equal to the incoming cookie is skipped entirely, so a returning
 * visitor gets no `Set-Cookie` at all.
 *
 * A resolved value that differs from the incoming cookie **wins**. If a
 * client-side language switch must survive, read `request.cookies` in your
 * resolver and return the value already there — whether the URL or the user's
 * choice wins is a product decision, not this function's.
 *
 * Deliberately does not touch the Emporix API or `getEmporixClient`: the Next
 * docs say proxy code must not rely on shared modules or globals, and
 * `getEmporixClient` memoizes in a module-level map.
 *
 * @param rewriteTo Omit for a pass-through (`NextResponse.next`). A relative
 *   string is resolved against `request.url`. Redirects do not need this
 *   function: there is no render to inject headers into, and the `Set-Cookie`
 *   travels with the redirect.
 *
 * @example
 * ```ts
 * // proxy.ts
 * export function proxy(request: NextRequest) {
 *   const seg = request.nextUrl.pathname.split("/")[1] ?? "";
 *   return emporixSiteProxy(request, {
 *     siteCode: "main",
 *     ...(LANGS.has(seg) ? { language: seg } : {}),
 *   });
 * }
 * ```
 */
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
    // Writes back the request's `cookie` header — see
    // next/dist/compiled/@edge-runtime/cookies/index.js:212-217.
    request.cookies.set(name, value);
    changed.push([name, value]);
  }

  // `{ request: { headers } }`, NOT `{ headers }`: the former forwards to the
  // render, the latter would send them to the client.
  const init = { request: { headers: request.headers } };
  const response =
    rewriteTo === undefined
      ? NextResponse.next(init)
      : NextResponse.rewrite(new URL(rewriteTo, request.url), init);

  for (const [name, value] of changed) {
    response.cookies.set(name, value, {
      path: "/",
      sameSite: "lax",
      // NOT httpOnly, on purpose and unlike `emporixSessionMutable`: the
      // browser-side createCookieStorage must read these two, or the storage
      // precedence step in SiteContextProvider never fires.
      httpOnly: false,
      // Derived, not hard `true`: hard `true` silently drops the cookie on an
      // HTTP staging host, which is fail-closed and miserable to diagnose.
      // Behind a TLS-terminating reverse proxy Next reports `http:` and no
      // `Secure` is set — fail-open, and the cookie still works.
      secure: request.nextUrl.protocol === "https:",
      maxAge: MAX_AGE,
    });
  }
  return response;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
pnpm -F @viu/emporix-sdk-next exec vitest run tests/proxy.test.ts
```

Expected: `Tests 10 passed (10)`.

If the suite cannot resolve `COOKIE_NAMES`, react was not rebuilt after Task 1 —
run `pnpm -F @viu/emporix-sdk-react build` and retry.

- [ ] **Step 5: Mutation-test the two guards that passed first try**

A guard that has never failed is not known to work. Mutate each, confirm
**exactly** the expected test fails, then revert.

Mutation A — the security-relevant line. In `proxy.ts`, change
`httpOnly: false` to `httpOnly: true` and run the suite.
Expected: exactly 1 failure, `never marks the site cookies HttpOnly`, with
`expected 'emporix.language=de; Path=/; …; HttpOnly' not to contain 'HttpOnly'`.
Revert to `httpOnly: false`.

Mutation B — the no-op guard. Delete the line
`if (request.cookies.get(name)?.value === value) continue;` and run the suite.
Expected: exactly 1 failure, `writes nothing when both cookies already match`,
with `expected length 0, received 2`. Restore the line.

If either mutation produces zero failures, or failures in other tests, stop and
work out why before continuing — the test does not cover what it claims to.

- [ ] **Step 6: Add the build entry**

In `packages/next/tsup.config.ts`, the `entry` line currently reads:

```ts
  entry: { index: "src/index.ts", webhook: "src/webhook.ts" },
```

Replace it, and extend the comment above it, so the block reads:

```ts
  // `webhook` is its own entry so a Route Handler does not pull the client and
  // session code (and with it `next/headers`). `proxy` likewise: `cookies()`
  // from `next/headers` is not available in a proxy at all.
  entry: { index: "src/index.ts", webhook: "src/webhook.ts", proxy: "src/proxy.ts" },
```

- [ ] **Step 7: Add the subpath export**

In `packages/next/package.json`, the `exports` map ends with:

```json
    "./webhook": {
      "types": "./dist/webhook.d.ts",
      "import": "./dist/webhook.js",
      "require": "./dist/webhook.cjs"
    },
    "./package.json": "./package.json"
```

Insert a `"./proxy"` block between them:

```json
    "./webhook": {
      "types": "./dist/webhook.d.ts",
      "import": "./dist/webhook.js",
      "require": "./dist/webhook.cjs"
    },
    "./proxy": {
      "types": "./dist/proxy.d.ts",
      "import": "./dist/proxy.js",
      "require": "./dist/proxy.cjs"
    },
    "./package.json": "./package.json"
```

- [ ] **Step 8: Build and confirm all six proxy artefacts exist**

Run:

```bash
pnpm -F @viu/emporix-sdk-next build
```

Then:

```bash
ls packages/next/dist/proxy.js packages/next/dist/proxy.cjs packages/next/dist/proxy.d.ts packages/next/dist/proxy.d.cts
```

Expected: all four listed without error. `tsup` emits `.d.cts` alongside
`.d.ts` for the `cjs` format; a missing one means `dts: true` did not run for
this entry.

Then confirm the entry did not bundle `next/headers` in:

```bash
grep -c "next/headers" packages/next/dist/proxy.js || echo "clean: no next/headers in the proxy entry"
```

Expected: `clean: no next/headers in the proxy entry`. A non-zero count means
`src/proxy.ts` imported something from `src/session.ts` or `src/index.ts`.

- [ ] **Step 9: Full local gate**

Run:

```bash
pnpm typecheck && pnpm lint && pnpm -r test
```

Expected: all green. The `packages/next` test count goes from 69 to 79 — the
existing suites are `tags` (22), `client` (15), `session` (7) and `webhook`
(25), which is 69, plus the 10 new proxy tests.

- [ ] **Step 10: Commit**

```bash
git add packages/next/src/proxy.ts packages/next/tests/proxy.test.ts packages/next/tsup.config.ts packages/next/package.json
git commit -m "feat(repo): add emporixSiteProxy for site and locale detection" -m "A Next 16 proxy.ts can now resolve siteCode/language per request and have both
halves of the cache key see it: the value goes into the forwarded request
cookies, so emporixSession() sees it in this render, and into a
browser-readable Set-Cookie, so createCookieStorage seeds the client
SiteContextProvider.

Generic on purpose — the package owns the Emporix cookie mechanics, the
storefront owns the routing policy. No Emporix call and no getEmporixClient
import: the Next docs rule out relying on shared modules or globals in proxy
code, and getEmporixClient memoizes in a module-level map.

Own build entry because cookies() from next/headers does not exist in a proxy
context and must not be reachable through the barrel."
```

---

## Task 3: Docs, changesets, live verification, PR

**Files:**
- Modify: `packages/next/README.md` (new section before `## Footgun`, and the
  `## Subpath exports` paragraph)
- Create: `.changeset/react-cookie-names-export.md`
- Create: `.changeset/next-proxy-site-detection.md`
- Temporary, **never committed**: `examples/next-app-router/proxy.ts`

**Interfaces:**
- Consumes: `emporixSiteProxy(request, site, rewriteTo?)` and `EmporixSite` from
  `@viu/emporix-sdk-next/proxy` (Task 2); `COOKIE_NAMES` from
  `@viu/emporix-sdk-react/ssr` (Task 1).
- Produces: nothing further consumed in this plan.

- [ ] **Step 1: Add the README section**

`packages/next/README.md` currently has this heading order: `## Cache tags`,
`## Environment`, `### What getEmporixClient deliberately cannot do`,
`## Footgun: httpOnly and the browser`, `## next/image`,
`## Subpath exports`.

Insert this section **immediately before** `## Footgun: \`httpOnly\` and the
browser`:

````markdown
## Site and locale detection (`proxy.ts`)

`siteCode` and `language` go into two places that have to agree: the server's
`getEmporixClient({ context })` and `prefetchEmporix` keys, and the client's
`SiteContextProvider`. Disagree and every hydration cache hit becomes a miss.
A `proxy.ts` is the only place to resolve them before the render.

`emporixSiteProxy` owns the cookie mechanics. You own the routing policy:

```ts
// proxy.ts (project root, or src/proxy.ts)
import type { NextRequest } from "next/server";
import { emporixSiteProxy } from "@viu/emporix-sdk-next/proxy";

const LANGUAGES = new Set(["de", "fr", "en"]);

export function proxy(request: NextRequest) {
  const segment = request.nextUrl.pathname.split("/")[1] ?? "";
  return emporixSiteProxy(request, {
    siteCode: "main",
    ...(LANGUAGES.has(segment) ? { language: segment } : {}),
  });
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
```

Pass a third argument to rewrite instead of passing through —
`emporixSiteProxy(request, site, "/shoes")` resolves a relative target against
the request URL. Redirects do not need the function: there is no render to
inject headers into, and the `Set-Cookie` travels with the redirect.

### Three things that will bite you

**The `matcher` cannot come from this package.** Next requires a statically
analysable literal — «Dynamic values such as variables will be ignored». An
imported constant is a variable, so it would be silently dropped and your proxy
would run on `_next/static` and `public/` too. Write it inline, as above.

**The client needs `createCookieStorage`.** `emporixSiteProxy` writes cookies;
with `createMemoryStorage` or a localStorage backend the browser half of the
chain is dead and only the server sees the resolved site.

**A resolved value overwrites the cookie.** If a client-side language switch
must survive, read `request.cookies` in your resolver and return what is already
there. Whether the URL or the user's choice wins is your decision, not the
package's.

### Node runtime only

Next 16 renamed `middleware` to `proxy` and pinned it to the Node runtime.
`export const runtime = "edge"` in a proxy file throws — «Proxy always runs on
Node.js runtime».
````

- [ ] **Step 2: Update the subpath export paragraph**

In the same file, `## Subpath exports` currently reads:

```markdown
`.` (client, session, tags) and `./webhook` (verification, route factory). The
split keeps a Route Handler from pulling in `next/headers`.
```

Replace with:

```markdown
`.` (client, session, tags), `./webhook` (verification, route factory) and
`./proxy` (`emporixSiteProxy`). The split keeps a Route Handler from pulling in
`next/headers` — and a `proxy.ts` cannot pull it in at all, because `cookies()`
does not exist in a proxy context.
```

- [ ] **Step 3: Write the react changeset**

Create `.changeset/react-cookie-names-export.md`:

```markdown
---
"@viu/emporix-sdk-react": minor
---

`COOKIE_NAMES` is now exported from `@viu/emporix-sdk-react/ssr`.

The eight persisted session keys as cookie names — `emporix.customerToken`,
`emporix.cartId`, `emporix.anonymousSession`, `emporix.siteCode`,
`emporix.language`, `emporix.activeLegalEntityId`, `emporix.refreshToken`,
`emporix.saasToken`. Server code that has to name a cookie without going
through an `EmporixStorage` can now read them instead of duplicating the
literal.

Exported from `./ssr` rather than `./storage` on purpose: `./storage` carries
the `"use client"` banner and must not be imported from a Next `proxy.ts` or a
Route Handler. Nothing else changed — no behaviour, no existing export.
```

- [ ] **Step 4: Write the next changeset**

Create `.changeset/next-proxy-site-detection.md`:

````markdown
---
"@viu/emporix-sdk-next": minor
---

New entry `@viu/emporix-sdk-next/proxy` with `emporixSiteProxy`.

```ts
emporixSiteProxy(request, { siteCode: "main", language: "de" })
emporixSiteProxy(request, site, "/shoes")   // rewrite instead of pass-through
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

Requires `@viu/emporix-sdk-react` with `COOKIE_NAMES` exported from `./ssr`.
````

- [ ] **Step 5: Verify the changesets are picked up**

Run:

```bash
pnpm changeset status
```

Expected: `@viu/emporix-sdk-react` and `@viu/emporix-sdk-next` both listed for a
minor bump. `@viu/emporix-sdk` will also appear at minor — it is in the same
`linked` group as react (`.changeset/config.json`), which forces both to the
same version. That is expected, not a mistake.

- [ ] **Step 6: Build everything the live check needs**

Run:

```bash
pnpm -r --filter "./packages/*" build
```

Expected: 4 of 10 projects built, no errors. The example typechecks and builds
against `dist/`, so this must run before the next step.

- [ ] **Step 7: Create the temporary proxy in the example**

Unit tests prove the function builds the right objects. They do **not** prove
Next actually forwards the mutated headers or emits the `Set-Cookie`. Only a
running server shows that.

Create `examples/next-app-router/proxy.ts` — this file gets deleted in Step 10
and must never be committed:

```ts
// TEMPORARY — verification only, delete after checking. Do not commit.
import type { NextRequest } from "next/server";
import { emporixSiteProxy } from "@viu/emporix-sdk-next/proxy";

const LANGUAGES = new Set(["de", "fr", "en"]);

export function proxy(request: NextRequest) {
  const segment = request.nextUrl.pathname.split("/")[1] ?? "";
  return emporixSiteProxy(request, {
    siteCode: "main",
    ...(LANGUAGES.has(segment) ? { language: segment } : {}),
  });
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
```

- [ ] **Step 8: Build and start the example**

`examples/next-app-router/.env.local` must exist — it holds the tenant
credentials and is untracked (`.gitignore:7`). Never print its contents.

Run:

```bash
pnpm -F @viu/emporix-examples-next-app-router build
```

Expected: a successful build. Next will report the proxy in its output.

Then start it in the background on port 3000:

```bash
pnpm -F @viu/emporix-examples-next-app-router exec next start
```

- [ ] **Step 9: Check the two live behaviours**

First request, no cookies:

```bash
curl -sD- -o /dev/null http://localhost:3000/de/ | grep -i "^set-cookie"
```

Expected: two `set-cookie` lines, one `emporix.siteCode=main`, one
`emporix.language=de`, each with `Path=/` and `Max-Age=31536000`, and
**without** `Secure` (the request was plain http) and **without** `HttpOnly`.

Second request, cookies already correct:

```bash
curl -sD- -o /dev/null -b "emporix.siteCode=main; emporix.language=de" http://localhost:3000/de/ | grep -ic "^set-cookie" || echo "no Set-Cookie — no-op guard works"
```

Expected: `no Set-Cookie — no-op guard works`.

If the first check shows no `set-cookie` at all, the `matcher` excluded `/de/` —
check the negative lookahead. If it shows `HttpOnly`, `httpOnly: false` was lost
in Task 2 and the mutation test in Step 5 of Task 2 did not actually run.

Stop the server when done.

- [ ] **Step 10: Delete the temporary proxy and prove the tree is clean**

```bash
rm examples/next-app-router/proxy.ts
git status --short
```

Expected output lists **only** the intended changes:
`packages/next/README.md`, `.changeset/react-cookie-names-export.md`,
`.changeset/next-proxy-site-detection.md`. No `examples/` entry, no
`*.tsbuildinfo`, no `dist/`.

If `examples/next-app-router/proxy.ts` still appears, the delete did not happen
— it must not reach the commit.

- [ ] **Step 11: Commit the docs and changesets**

```bash
git add packages/next/README.md .changeset/react-cookie-names-export.md .changeset/next-proxy-site-detection.md
git commit -m "docs(repo): document the proxy site-detection entry" -m "Copy-paste proxy.ts with the matcher written inline, and the three things that
bite: the matcher cannot be imported (Next silently ignores a variable), the
client half needs createCookieStorage, and a resolved value overwrites the
cookie."
```

- [ ] **Step 12: Push and open the PR**

Push over SSH — the `gh` CLI token (`gho_…`) is rejected for git operations
with `Password authentication is not supported for Git operations`:

```bash
git push origin feat/next-proxy-site-detection
```

Then open the PR against `main`:

```bash
gh pr create --base main --title "feat(repo): add emporixSiteProxy for Next 16 site and locale detection" --body "$(cat <<'BODY'
Closes the middleware follow-up from `@viu/emporix-sdk-next`. New entry
`@viu/emporix-sdk-next/proxy` with one function.

## What

`emporixSiteProxy(request, site, rewriteTo?)` persists a resolved
`siteCode`/`language` for one request. Each changed value is written twice, and
both writes are load-bearing:

- into the **forwarded request** cookies, so `emporixSession()` sees it in the
  current render rather than the next one;
- as a browser-readable **`Set-Cookie`**, so `createCookieStorage` seeds the
  client `SiteContextProvider` and the hydration key matches the one the server
  prefetched with.

A value equal to the incoming cookie is skipped, so a returning visitor gets no
`Set-Cookie` at all.

## Generic on purpose

No host map, no locale list, no `matcher`, no Emporix call. The package owns the
cookie mechanics, the storefront owns the routing policy — this is a published
package meant to carry several storefronts, and a convention baked into an npm
version is one storefront's policy that the others have to work around.

The `matcher` in particular **cannot** be exported: Next needs a statically
analysable literal and «Dynamic values such as variables will be ignored», so an
imported one would be silently dropped and the proxy would run on
`_next/static`. It is documented inline instead.

`getEmporixClient` is deliberately not imported — it memoizes in a module-level
map, and the Next docs say proxy code must not rely on shared modules or
globals.

## The one security-relevant line

The two site cookies are **not** `httpOnly`, the opposite of
`emporixSessionMutable`. The browser has to read them or the storage precedence
step in `SiteContextProvider` never fires. `secure` is derived from the request
protocol rather than hard-coded `true`, because hard `true` silently drops the
cookie on an HTTP staging host — fail-closed and miserable to diagnose.

## Verification

Ten unit tests against real `NextRequest`/`NextResponse`. Two of them passed
first try, so both were mutation-tested: flipping `httpOnly` to `true` fails
exactly the `HttpOnly` test, and deleting the no-op guard fails exactly the
already-matching-cookie test.

Unit tests cannot prove Next forwards the mutated headers, so that was checked
against a running `next start` with a temporary, uncommitted `proxy.ts` in the
example: a cookieless request returns both `Set-Cookie` headers without `Secure`
(plain http) and without `HttpOnly`, and a request that already carries the
right cookies returns none.

## Honest scope note

This is the weakest of the three open follow-ups. Next itself recommends
avoiding proxy «unless no other options exist», and locale-by-path-prefix has a
better answer in Next 16: `app/[locale]/…` plus `await locale()` from
`next/root-params`. The proxy is only required when the discriminator is the
host, or when the first visit should guess from `Accept-Language` and persist
it. Single-site, single-language storefronts need none of this —
`getEmporixClient({ context })` is enough.

Spec: `docs/superpowers/specs/2026-07-31-next-proxy-site-detection-design.md`
Plan: `docs/superpowers/plans/2026-07-31-next-proxy-site-detection.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

- [ ] **Step 13: Wait for all checks and report**

Run:

```bash
gh pr checks --watch
```

Expected: all 7 green — `quality (node 20)`, `quality (node 22)`,
`quality (node 24)`, `Analyze (actions)`, `Analyze (javascript-typescript)`,
`CodeQL`, `changeset`.

Do **not** merge. Merging is the user's call.

---

## Self-Review

**1. Spec coverage**

| Spec requirement | Task |
|---|---|
| Generic, no policy in the package | Task 2 Step 3 (no host map / locale list in the code), Task 3 Step 4 (changeset states it) |
| Overwrite semantics documented + tested | Task 2 Step 1 test 10, Task 2 Step 3 JSDoc, Task 3 Step 1 README |
| `emporixSiteProxy(request, site, rewriteTo?)` | Task 2 Step 3 |
| Double write, request + response | Task 2 Step 3, tests 1 and 2 |
| `httpOnly: false` explicit | Task 2 Step 3, test 9, mutation A |
| `secure` derived from protocol | Task 2 Step 3, test 8 |
| No-op guard | Task 2 Step 3, test 3, mutation B |
| Own tsup entry, not cosmetic | Task 2 Steps 6-8, including the `next/headers` grep |
| `"./proxy"` subpath export | Task 2 Step 7 |
| `COOKIE_NAMES` from `./ssr`, not `./storage` | Task 1 entirely |
| No `matcher` export, documented inline | Task 3 Steps 1 and 4 |
| No cookie delete | Task 2 Step 3 (`EmporixSite` JSDoc) |
| No redirect path | Task 2 Step 3 (`rewriteTo` JSDoc), Task 3 Step 1 |
| No Emporix call / `getEmporixClient` import | Task 2 Step 3 JSDoc |
| No committed example change | Task 3 Steps 7 and 10 |
| Ten unit tests | Task 2 Step 1 |
| Rewrite via `x-middleware-rewrite` with source note | Task 2 Step 1, test 6 |
| Live verification against a real server | Task 3 Steps 7-9 |
| README section | Task 3 Steps 1-2 |
| One PR, one release, changesets in topological order | Task 3 Step 5 |
| Honest scope note | Task 3 Step 12 PR body |

No gaps.

**2. Placeholder scan**

No `TBD`, no `TODO`, no "add error handling", no "similar to Task N". Every code
step carries the actual code. Every verification step carries the actual command
and the expected output.

**3. Type consistency**

`emporixSiteProxy` and `EmporixSite` are spelled identically in Task 2's
interface block, implementation, test file, README, changeset and PR body.
`COOKIE_NAMES.siteCode` / `COOKIE_NAMES.language` match the keys measured in
`packages/react/src/storage/cookie-core.ts:12-21`. The test file uses the string
literals `"emporix.siteCode"` / `"emporix.language"` deliberately rather than
importing the constant.

One arithmetic claim to keep honest: Task 2 Step 9 says the `packages/next` test
count goes 69 → 79. Derivation: `tags` 22 + `client` 15 + `session` 7 +
`webhook` 25 = 69, plus 10 new = 79. If the observed starting number is not 69,
stop and find out what changed — do not adjust the expectation to fit.
