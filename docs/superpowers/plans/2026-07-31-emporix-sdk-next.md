# `@viu/emporix-sdk-next` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new published package `@viu/emporix-sdk-next` giving every viu Next.js storefront the same server-side wiring — one client per process, session from cookies, and URL-derived cache tags that an Emporix webhook can invalidate.

**Architecture:** The SDK gains a client-level injectable `fetch` (two call sites). The new package supplies a `fetch` that derives Next cache tags from the Emporix request URL, so tagging cannot be forgotten at any of the 596 service call sites. Session helpers are thin wrappers over `@viu/emporix-sdk-react/ssr`'s `createServerStorage`/`serverAuth`. Personalized reads are separated by an explicitly untagged client rather than detected.

**Tech Stack:** TypeScript 5.6+ (`strict`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), Next 15 (`next/headers`, `next/cache`), tsup 8, Vitest 2 + MSW 2, Changesets.

**Spec:** [`../specs/2026-07-31-emporix-sdk-next-design.md`](../specs/2026-07-31-emporix-sdk-next-design.md)

## Global Constraints

- **Two PRs, in order.** Task 1 goes on a branch cut from `main` and must merge before the package can be published. Tasks 2–6 go on `feat/emporix-sdk-next` (which already carries the spec and this plan), rebased on `main` after Task 1 lands.
- **`tsconfig.base.json` is strict in ways that bite:** `exactOptionalPropertyTypes: true` (so `{ x: undefined }` ≠ omitting `x` — use the repo's `...(v !== undefined ? { v } : {})` pattern), `noUncheckedIndexedAccess: true` (array/index access yields `T | undefined`), `verbatimModuleSyntax: true` (type-only imports need `import type`), `moduleResolution: "bundler"`.
- **Every package has its own flat `eslint.config.js`** enforcing `no-console: "error"`, `@typescript-eslint/no-explicit-any: "error"`, and **no default exports**. The new package needs its own copy.
- **No runtime dependencies** in the new package. `next`, `@viu/emporix-sdk` and `@viu/emporix-sdk-react` are all peers.
- **Version `0.1.0`**, and do **not** add the package to the changesets `linked` group (`.changeset/config.json` currently links `@viu/emporix-sdk` with `@viu/emporix-sdk-react`, both 2.x). `@viu/emporix-mixins` at 0.2.0 unlinked is the precedent.
- **Zero workflow or root-config changes.** `pnpm-workspace.yaml` (`packages/*`), the root scripts (`--filter "./packages/*"`), and `pr-check.yml`'s build step (`pnpm -r --filter "./packages/*" build`) are all glob-based. Verified 2026-07-31. If you find yourself editing `.github/workflows/`, stop and re-read this line.
- **Commitlint:** allowed scopes are `repo, release, sdk, react, core, customer, product, category, cart, checkout, payment, price, media, segment, availability, auth, http, logger, deps, docs, examples`. **There is no `next` scope** — use `repo` for package-level commits and `http`/`core` for the SDK change. First word after the scope must be a lowercase verb.
- **Security rule that must not be softened:** the tagged client is for anonymous reads only. Never attempt to detect a customer token inside the `fetch` wrapper — it is provably impossible (both arrive as `Bearer <jwt>`), and Next's fetch cache does not key on `Authorization`, so a wrong guess leaks one shopper's data to another.
- **Gates before each commit:** `pnpm -F <pkg> test`, `pnpm -F <pkg> typecheck`, `pnpm -F <pkg> lint`. Before the final commit of each PR: `pnpm -r test && pnpm typecheck && pnpm lint`.

---

## File Structure

### PR 1 — `@viu/emporix-sdk` (Task 1)

| File | Change |
|---|---|
| `packages/sdk/src/core/config.ts` | `EmporixConfig.fetch?` (after line 50), `ResolvedConfig.fetch` (after line 62), pass through in `validateConfig` (line ~89) |
| `packages/sdk/src/core/http.ts` | `HttpClientOptions.fetch?` (after line 47), a private resolved field, use it at lines 141 and 277 |
| `packages/sdk/src/core/create-core.ts` | thread `cfg.fetch` into the `new HttpClient({...})` at lines 71–79 |
| `packages/sdk/tests/injectable-fetch.test.ts` | new |
| `.changeset/sdk-injectable-fetch.md` | new, minor |

### PR 2 — `packages/next/` (Tasks 2–6)

| File | Responsibility | Task |
|---|---|---|
| `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `eslint.config.js` | package scaffolding | 2 |
| `src/tags.ts` | `emporixTags` constructors + `emporixTagsForUrl` + reserved segments | 2 |
| `src/client.ts` | `createTaggingFetch` + memoized `getEmporixClient` | 3 |
| `src/session.ts` | `emporixSession` / `emporixSessionMutable` over `./ssr` | 4 |
| `src/webhook.ts` | `verifyEmporixSignature` + `createEmporixWebhookRoute` | 5 (conditional) |
| `src/index.ts` | barrel: tags, client, session | 2, 3, 4 |
| `README.md` | usage + the two footguns | 6 |
| `tests/tags.test.ts` | mapping, reserved segments, unknown paths | 2 |
| `tests/client.test.ts` | memoization key, tagged vs untagged, GET-only | 3 |
| `tests/session.test.ts` | read-only vs mutable, cookie attributes | 4 |
| `tests/webhook.test.ts` | signature accept/reject, replay window, tag calls | 5 |

**No MSW in this package, unlike `packages/sdk` and `packages/react`.** The
fetch-tagging tests must observe the `next: { tags }` field that the wrapper adds
to `RequestInit` — and MSW intercepts `fetch` itself, so it would swallow exactly
the thing under test. These tests spy on `globalThis.fetch` instead and assert
what the wrapper handed it. The spec's testing section suggested MSW; it is wrong
for this one reason.

---

## Task 1: Injectable `fetch` in `@viu/emporix-sdk` (PR 1)

**Files:**
- Modify: `packages/sdk/src/core/config.ts:50`, `:62`, `:89`
- Modify: `packages/sdk/src/core/http.ts:47`, `:141`, `:277`
- Modify: `packages/sdk/src/core/create-core.ts:71-79`
- Create: `packages/sdk/tests/injectable-fetch.test.ts`
- Create: `.changeset/sdk-injectable-fetch.md`

**Interfaces:**
- Produces: `EmporixConfig.fetch?: typeof globalThis.fetch` — consumed by Task 3's `getEmporixClient`.

- [ ] **Step 1: Cut the branch from `main`**

```bash
git checkout main && git pull --ff-only origin main
git checkout -b feat/sdk-injectable-fetch
```

This branch must NOT contain the spec/plan commits — those live on `feat/emporix-sdk-next`.

- [ ] **Step 2: Write the failing test**

Create `packages/sdk/tests/injectable-fetch.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { EmporixClient, auth } from "../src/index";

/** A fetch double that records calls and answers everything with JSON. */
function recordingFetch(body: unknown = { id: "p1" }) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const impl: typeof globalThis.fetch = (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  return { calls, impl };
}

function makeClient(fetchImpl?: typeof globalThis.fetch): EmporixClient {
  return new EmporixClient({
    tenant: "acme",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
}

describe("EmporixConfig.fetch", () => {
  it("routes API requests through the injected fetch", async () => {
    const { calls, impl } = recordingFetch();
    // The token request must not hit the injected fetch, so stub the provider.
    const client = new EmporixClient({
      tenant: "acme",
      credentials: { storefront: { clientId: "sf" } },
      logger: false,
      fetch: impl,
      tokenProvider: {
        getToken: () => Promise.resolve("tok"),
        invalidate: () => {},
      },
    });

    const product = await client.products.get("p1", undefined, auth.anonymous());

    expect(product).toEqual({ id: "p1" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/product/acme/products/p1");
    expect(calls[0]!.init?.method).toBe("GET");
  });

  it("does NOT route token requests through the injected fetch", async () => {
    const globalSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "anon",
          token_type: "Bearer",
          expires_in: 3599,
          refresh_token: "rt",
          sessionId: "s",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const { calls, impl } = recordingFetch();
    const client = makeClient(impl);

    await client.products.get("p1", undefined, auth.anonymous()).catch(() => {
      // The product response comes from `impl`; a parse error here is fine —
      // this test only asserts WHERE the token request went.
    });

    // The anonymous-login call went to the global fetch, not the injected one.
    const tokenCalls = globalSpy.mock.calls.filter((c) =>
      String(c[0]).includes("/customerlogin/auth/anonymous/login"),
    );
    expect(tokenCalls).toHaveLength(1);
    expect(calls.some((c) => c.url.includes("/customerlogin/"))).toBe(false);

    globalSpy.mockRestore();
  });

  it("falls back to the global fetch when no fetch is configured", async () => {
    const globalSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );
    const client = new EmporixClient({
      tenant: "acme",
      credentials: { storefront: { clientId: "sf" } },
      logger: false,
      tokenProvider: { getToken: () => Promise.resolve("tok"), invalidate: () => {} },
    });

    await client.products.get("p1", undefined, auth.anonymous());

    expect(globalSpy).toHaveBeenCalled();
    globalSpy.mockRestore();
  });
});
```

If `TokenProvider` does not have exactly the shape `{ getToken, invalidate }`, read `packages/sdk/src/core/auth.ts` for the real interface and match it — the point of the stub is only to keep the token path out of the assertion.

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/injectable-fetch.test.ts`
Expected: FAIL — TypeScript rejects the unknown `fetch` property on `EmporixConfig`.

- [ ] **Step 4: Add `fetch` to config**

In `packages/sdk/src/core/config.ts`, add to `EmporixConfig` after the `logger` line (~50):

```ts
  /**
   * Replaces the global `fetch` for API requests. Receives the same arguments.
   *
   * Deliberately NOT used for token requests (`core/auth.ts`) or SSE
   * (`HttpClient.stream`): a cached token response would be a security defect,
   * and caching an event stream is meaningless. Those keep the global `fetch`,
   * which makes them structurally uncacheable rather than uncached by
   * convention.
   */
  fetch?: typeof globalThis.fetch;
```

Add to `ResolvedConfig` after `logger` (~62):

```ts
  fetch: typeof globalThis.fetch | undefined;
```

And in `validateConfig`'s return object, after `logger: input.logger,`:

```ts
    fetch: input.fetch,
```

- [ ] **Step 5: Thread it into `HttpClient`**

In `packages/sdk/src/core/http.ts`, add to `HttpClientOptions` after `requestContext` (~47):

```ts
  /** Replaces the global `fetch` for API requests. Not used by token requests or SSE. */
  fetch?: typeof globalThis.fetch;
```

Add a resolved private field in the constructor (next to the existing `this.sleep` assignment, ~line 64):

```ts
  private readonly doFetch: typeof globalThis.fetch;
```
```ts
    this.doFetch = opts.fetch ?? ((...args) => globalThis.fetch(...args));
```

The arrow wrapper matters: assigning `globalThis.fetch` directly can lose its
binding in some runtimes.

Replace the two call sites:

- line 141: `res = await Promise.race([fetch(url, init), overallBudget]);`
  → `res = await Promise.race([this.doFetch(url, init), overallBudget]);`
- line 277: `return await fetch(url, init);`
  → `return await this.doFetch(url, init);`

Leave line 313 (`stream`, `Accept: text/event-stream`) on the global `fetch`.

- [ ] **Step 6: Pass the config through in `create-core.ts`**

In `packages/sdk/src/core/create-core.ts`, inside the `new HttpClient({...})` at lines 71–79, add after `requestContext,`:

```ts
      ...(cfg.fetch !== undefined ? { fetch: cfg.fetch } : {}),
```

The conditional spread is required: `exactOptionalPropertyTypes: true` makes
`{ fetch: undefined }` a type error against `fetch?: typeof globalThis.fetch`.

- [ ] **Step 7: Run the new test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/injectable-fetch.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 8: Run the whole SDK suite — the baseline is 834 tests**

Run: `pnpm -F @viu/emporix-sdk test 2>&1 | grep -E 'Tests |Test Files '`
Expected: `Tests  837 passed (837)` — 834 before plus the 3 new. Any failure here means the `doFetch` indirection changed request behaviour; fix the source, not the tests.

- [ ] **Step 9: Typecheck and lint**

Run: `pnpm -F @viu/emporix-sdk typecheck && pnpm -F @viu/emporix-sdk lint`
Expected: both clean.

- [ ] **Step 10: Write the changeset**

Create `.changeset/sdk-injectable-fetch.md`:

```markdown
---
"@viu/emporix-sdk": minor
---

`EmporixConfig.fetch` — replace the global `fetch` used for API requests.

```ts
const sdk = new EmporixClient({ tenant, credentials, fetch: myFetch });
```

Useful for tracing, test doubles, custom retry policies, and framework-level
caching (`@viu/emporix-sdk-next` uses it to attach Next cache tags).

Token requests and SSE deliberately keep using the global `fetch`: a cached
token response would be a security defect, and caching an event stream is
meaningless. Both are therefore structurally uncacheable, not merely uncached
by convention.
```

- [ ] **Step 11: Commit, push, open PR 1**

```bash
git add packages/sdk/src/core/config.ts packages/sdk/src/core/http.ts \
        packages/sdk/src/core/create-core.ts \
        packages/sdk/tests/injectable-fetch.test.ts \
        .changeset/sdk-injectable-fetch.md
git commit -m "feat(core): add injectable fetch to EmporixConfig

Client-level rather than per-request: the 596 http.request call sites in
services/ each build their own RequestOptions literal, so a per-request
fetchOptions field would reach none of them. Two call sites in http.ts cover
everything.

Token requests (auth.ts) and SSE (http.ts stream) keep the global fetch, so
neither can ever be cached."
git push origin feat/sdk-injectable-fetch
gh pr create --base main --title "feat(core): add injectable fetch to EmporixConfig" --body "$(cat <<'EOF'
Additive minor on `@viu/emporix-sdk`. Prerequisite for `@viu/emporix-sdk-next`.

`EmporixConfig.fetch` replaces the global `fetch` for API requests — for
tracing, test doubles, custom retry policies, and framework-level caching.

## Why client-level and not per-request

`packages/sdk/src/services/*.ts` holds 596 `this.ctx.http.request<…>({…})` call
sites, each building its own `RequestOptions` literal. A per-request
`fetchOptions` field would reach none of them without editing all 596. A
client-level `fetch` needs two call sites: `core/http.ts:141` and `:277`.

## Deliberately excluded

| Site | Why |
|---|---|
| `core/auth.ts:252` — token requests | a cached OAuth token response would be a security defect; keeping the global `fetch` makes it structurally uncacheable |
| `core/http.ts:313` — SSE | caching a `text/event-stream` is meaningless |

## Gates

SDK suite 837/837 (834 before plus 3 new), typecheck and lint clean.
EOF
)"
```

- [ ] **Step 12: After PR 1 merges, rebase the package branch**

```bash
git checkout main && git pull --ff-only origin main
git checkout feat/emporix-sdk-next && git rebase main
```

**Do not start Task 2 before this rebase.** Task 3 needs `EmporixConfig.fetch` to exist.

---

## Task 2: Scaffold the package and build the tag mapper (PR 2)

Scaffolding has no testable deliverable on its own, so it is folded into the task whose deliverable needs it. The tag mapper is pure and is the package's core logic.

**Files:**
- Create: `packages/next/package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `eslint.config.js`
- Create: `packages/next/src/tags.ts`, `packages/next/src/index.ts`
- Test: `packages/next/tests/tags.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const emporixTags: {
    product(id: string): string;
    readonly products: string;
    category(id: string): string;
    readonly categories: string;
    categoryTree(id: string): string;
    readonly prices: string;
    readonly availability: string;
    readonly sites: string;
  };
  export function emporixTagsForUrl(url: string, tenant: string): string[];
  ```
  Both consumed by Task 3 (`createTaggingFetch`) and Task 5 (webhook → tags).

- [ ] **Step 1: Create the package manifest**

`packages/next/package.json`:

```json
{
  "name": "@viu/emporix-sdk-next",
  "version": "0.1.0",
  "description": "Next.js server-side bindings for the Emporix SDK: cache tags, session, webhook revalidation",
  "license": "MIT",
  "author": { "name": "viu", "url": "https://github.com/viuteam" },
  "homepage": "https://github.com/viuteam/emporix-sdk/tree/main/packages/next#readme",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/viuteam/emporix-sdk.git",
    "directory": "packages/next"
  },
  "bugs": { "url": "https://github.com/viuteam/emporix-sdk/issues" },
  "keywords": ["emporix", "ecommerce", "commerce", "nextjs", "rsc", "typescript", "storefront"],
  "type": "module",
  "sideEffects": false,
  "engines": { "node": ">=20.19.0" },
  "files": ["dist", "README.md", "CHANGELOG.md", "LICENSE"],
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./webhook": {
      "types": "./dist/webhook.d.ts",
      "import": "./dist/webhook.js",
      "require": "./dist/webhook.cjs"
    },
    "./package.json": "./package.json"
  },
  "scripts": {
    "build": "tsup",
    "test": "vitest run --coverage",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "@viu/emporix-sdk": "workspace:^",
    "@viu/emporix-sdk-react": "workspace:^",
    "next": "^15.0.0"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "@vitest/coverage-v8": "^2.0.0",
    "@viu/emporix-sdk": "workspace:*",
    "@viu/emporix-sdk-react": "workspace:*",
    "eslint": "^9.0.0",
    "next": "^15.5.19",
    "tsup": "^8.2.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0"
  },
  "publishConfig": { "access": "public", "provenance": true }
}
```

Copy `packages/react/LICENSE` to `packages/next/LICENSE`.

- [ ] **Step 2: Create the build and tooling configs**

`packages/next/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "lib": ["ES2022", "DOM"],
    "types": ["node"]
  },
  "include": ["src", "tests"]
}
```

`lib` needs `DOM` for `Request`/`Response`/`Headers`/`RequestInit`.

`packages/next/tsup.config.ts`:

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", webhook: "src/webhook.ts" },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ["next", "@viu/emporix-sdk", "@viu/emporix-sdk-react"],
});
```

`packages/next/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // Test-only: resolve the workspace packages to source so tests need no
      // prebuild. Shipped code still imports the package names.
      "@viu/emporix-sdk-react/ssr": fileURLToPath(
        new URL("../react/src/ssr.ts", import.meta.url),
      ),
      "@viu/emporix-sdk": fileURLToPath(new URL("../sdk/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/index.ts"],
      thresholds: { lines: 80, branches: 80 },
    },
  },
});
```

The alias order matters — the more specific `@viu/emporix-sdk-react/ssr` must come before `@viu/emporix-sdk`, or the shorter prefix wins.

`packages/next/eslint.config.js`:

```js
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  { ignores: ["dist/**"] },
  {
    files: ["src/**/*.ts"],
    languageOptions: { parser: tsparser },
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      "no-console": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "no-restricted-syntax": [
        "error",
        { selector: "ExportDefaultDeclaration", message: "No default exports — use named exports." }
      ]
    }
  }
];
```

Run `pnpm install` so the workspace links the new package.

- [ ] **Step 3: Write the failing test**

Create `packages/next/tests/tags.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { emporixTags, emporixTagsForUrl } from "../src/tags";

const H = "https://api.emporix.io";
const T = "acme";

describe("emporixTags", () => {
  it("builds stable tag strings", () => {
    expect(emporixTags.product("p1")).toBe("emporix:product:p1");
    expect(emporixTags.products).toBe("emporix:products");
    expect(emporixTags.category("c1")).toBe("emporix:category:c1");
    expect(emporixTags.categories).toBe("emporix:categories");
    expect(emporixTags.categoryTree("t1")).toBe("emporix:category-tree:t1");
    expect(emporixTags.prices).toBe("emporix:prices");
    expect(emporixTags.availability).toBe("emporix:availability");
    expect(emporixTags.sites).toBe("emporix:sites");
  });
});

describe("emporixTagsForUrl — the mapping", () => {
  it("tags a single product with both its id tag and the collection", () => {
    expect(emporixTagsForUrl(`${H}/product/${T}/products/p1`, T)).toEqual([
      "emporix:product:p1",
      "emporix:products",
    ]);
  });

  it("tags a product listing with the collection only", () => {
    expect(emporixTagsForUrl(`${H}/product/${T}/products`, T)).toEqual(["emporix:products"]);
  });

  it("tags a single category and its sub-resources with the category", () => {
    expect(emporixTagsForUrl(`${H}/category/${T}/categories/c1`, T)).toEqual([
      "emporix:category:c1",
      "emporix:categories",
    ]);
    expect(emporixTagsForUrl(`${H}/category/${T}/categories/c1/subcategories`, T)).toEqual([
      "emporix:category:c1",
      "emporix:categories",
    ]);
    expect(emporixTagsForUrl(`${H}/category/${T}/categories/c1/parents`, T)).toEqual([
      "emporix:category:c1",
      "emporix:categories",
    ]);
  });

  it("tags category trees separately", () => {
    expect(emporixTagsForUrl(`${H}/category/${T}/category-trees/t1`, T)).toEqual([
      "emporix:category-tree:t1",
      "emporix:categories",
    ]);
  });

  it("tags price, availability and site reads by service", () => {
    expect(emporixTagsForUrl(`${H}/price/${T}/match-prices`, T)).toEqual(["emporix:prices"]);
    expect(emporixTagsForUrl(`${H}/availability/${T}/availability/site/main`, T)).toEqual([
      "emporix:availability",
    ]);
    expect(emporixTagsForUrl(`${H}/site/${T}/sites`, T)).toEqual(["emporix:sites"]);
  });

  it("decodes a percent-encoded id so the tag matches a webhook's raw id", () => {
    expect(emporixTagsForUrl(`${H}/category/${T}/category-trees/a%2Fb`, T)).toEqual([
      "emporix:category-tree:a/b",
      "emporix:categories",
    ]);
  });
});

describe("emporixTagsForUrl — reserved segments must not become ids", () => {
  // These are all real Emporix paths and all look like /products/{id}.
  it.each([
    [`${H}/product/${T}/products/bulk`, ["emporix:products"]],
    [`${H}/product/${T}/products/search`, ["emporix:products"]],
    [`${H}/product/${T}/products/recalculate`, ["emporix:products"]],
    [`${H}/product/${T}/products/recalculate/jobs`, ["emporix:products"]],
    [`${H}/category/${T}/categories/search`, ["emporix:categories"]],
    [`${H}/category/${T}/category-trees/search`, ["emporix:categories"]],
  ])("%s → %j", (url, expected) => {
    expect(emporixTagsForUrl(url, T)).toEqual(expected);
  });

  it("never emits an id tag for a reserved segment", () => {
    const tags = emporixTagsForUrl(`${H}/product/${T}/products/bulk`, T);
    expect(tags).not.toContain("emporix:product:bulk");
  });
});

describe("emporixTagsForUrl — everything else is untagged", () => {
  it.each([
    `${H}/product/other-tenant/products/p1`, // wrong tenant
    `${H}/product/${T}/product-templates/t1`, // untagged collection
    `${H}/category/${T}/assignments/references/r1`, // untagged collection
    `${H}/cart/${T}/carts/c1`, // cart is never cached
    `${H}/customerlogin/auth/anonymous/login`, // token endpoint
    `${H}/order-v2/${T}/orders/o1`, // personalized
    "not-a-url",
    `${H}/`,
  ])("%s → []", (url) => {
    expect(emporixTagsForUrl(url, T)).toEqual([]);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-next exec vitest run tests/tags.test.ts`
Expected: FAIL — `Failed to resolve import "../src/tags"`.

- [ ] **Step 5: Write `src/tags.ts`**

```ts
/**
 * Cache-tag vocabulary and the URL→tag mapping.
 *
 * Tags are derived from the request URL rather than passed per call because the
 * SDK has 596 `http.request({...})` call sites, each building its own options
 * literal — a per-call tag would be forgotten somewhere. Deriving centrally
 * makes that impossible.
 */

/** Tag constructors. Keep these stable: they are what `revalidateTag` receives. */
export const emporixTags = {
  product: (id: string): string => `emporix:product:${id}`,
  products: "emporix:products",
  category: (id: string): string => `emporix:category:${id}`,
  categories: "emporix:categories",
  categoryTree: (id: string): string => `emporix:category-tree:${id}`,
  prices: "emporix:prices",
  availability: "emporix:availability",
  sites: "emporix:sites",
} as const;

/**
 * Path segments that appear where an id would and are NOT ids.
 * All real: `/products/bulk`, `/products/search`, `/products/recalculate`,
 * `/products/recalculate/jobs`, `/categories/search`, `/category-trees/search`.
 * Without this, the mapper emits `emporix:product:bulk`.
 */
const RESERVED = new Set(["bulk", "search", "recalculate", "jobs"]);

/** `undefined` or a reserved word means "this is the collection, not an item". */
function itemId(segment: string | undefined): string | null {
  if (segment === undefined || RESERVED.has(segment)) return null;
  return decodeURIComponent(segment);
}

/**
 * Maps an Emporix API URL to the Next cache tags its response should carry.
 * Returns `[]` for anything not safe to cache — a different tenant, a
 * non-catalog service, a personalized resource, or an unparseable URL.
 *
 * Cart, order, customer and token endpoints intentionally return `[]`: they are
 * either mutable per shopper or secret.
 */
export function emporixTagsForUrl(url: string, tenant: string): string[] {
  let segments: string[];
  try {
    segments = new URL(url).pathname.split("/").filter((s) => s.length > 0);
  } catch {
    return [];
  }
  const [service, urlTenant, collection, third] = segments;
  if (urlTenant !== tenant) return [];

  switch (service) {
    case "product": {
      if (collection !== "products") return [];
      const id = itemId(third);
      return id === null ? [emporixTags.products] : [emporixTags.product(id), emporixTags.products];
    }
    case "category": {
      if (collection === "categories") {
        const id = itemId(third);
        return id === null
          ? [emporixTags.categories]
          : [emporixTags.category(id), emporixTags.categories];
      }
      if (collection === "category-trees") {
        const id = itemId(third);
        return id === null
          ? [emporixTags.categories]
          : [emporixTags.categoryTree(id), emporixTags.categories];
      }
      return [];
    }
    case "price":
      return [emporixTags.prices];
    case "availability":
      return [emporixTags.availability];
    case "site":
      return [emporixTags.sites];
    default:
      return [];
  }
}
```

`noUncheckedIndexedAccess` is why the destructured segments are typed
`string | undefined` and why `itemId` takes `string | undefined`.

- [ ] **Step 6: Create the barrel**

`packages/next/src/index.ts`:

```ts
export { emporixTags, emporixTagsForUrl } from "./tags";
```

Tasks 3 and 4 append to this file.

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk-next exec vitest run tests/tags.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 8: Prove the scaffolding works end to end**

Run: `pnpm -F @viu/emporix-sdk-next build && pnpm -F @viu/emporix-sdk-next typecheck && pnpm -F @viu/emporix-sdk-next lint`
Expected: all clean. `dist/index.js`, `dist/index.cjs`, `dist/index.d.ts` exist. The `webhook` entry will fail the build until Task 5 — until then, remove `webhook` from `tsup.config.ts`'s `entry` and from `package.json`'s `exports`, and add them back in Task 5. Note that as a deliberate temporary state in the commit message.

Then confirm the glob-based tooling picked the package up with no config change:

Run: `pnpm -r --filter "./packages/*" build 2>&1 | grep -c 'emporix-sdk-next'`
Expected: a non-zero count.

- [ ] **Step 9: Commit**

```bash
git add packages/next
git commit -m "feat(repo): scaffold @viu/emporix-sdk-next with the url-to-tag mapper

Cache tags are derived from the request URL because the SDK has 596
http.request call sites; a per-call tag would be forgotten somewhere.

The mapper keeps a reserved-segment set (bulk, search, recalculate, jobs) —
without it /products/bulk yields the tag emporix:product:bulk. All six real
reserved paths are covered by tests.

The webhook entry is temporarily absent from tsup/exports; Task 5 adds it."
```

---

## Task 3: Tagging fetch and the memoized client

**Files:**
- Create: `packages/next/src/client.ts`
- Modify: `packages/next/src/index.ts`
- Test: `packages/next/tests/client.test.ts`

**Interfaces:**
- Consumes: `emporixTagsForUrl` (Task 2); `EmporixConfig.fetch` (Task 1).
- Produces:
  ```ts
  export interface GetEmporixClientOptions {
    tenant?: string;
    clientId?: string;
    host?: string;
    tagged?: boolean;
    revalidate?: number;
  }
  export function getEmporixClient(opts?: GetEmporixClientOptions): EmporixClient;
  export function createTaggingFetch(opts: {
    tenant: string;
    revalidate: number;
  }): typeof globalThis.fetch;
  export function __resetEmporixClients(): void;   // test-only
  ```
  `getEmporixClient` is consumed by Task 6's README examples.

**Deliberate narrowing of the spec.** The spec sketched
`getEmporixClient(config?: Partial<EmporixConfig>)`. That is a latent bug: the
memoization key cannot cover arbitrary config, so two calls differing in, say,
`retry` would silently share one client. The five explicit options above are
fully covered by the key. Consumers needing more construct `new EmporixClient`
themselves and pass `fetch: createTaggingFetch({ tenant, revalidate })` — which
is why `createTaggingFetch` is exported.

- [ ] **Step 1: Write the failing test**

Create `packages/next/tests/client.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { auth } from "@viu/emporix-sdk";
import {
  getEmporixClient,
  createTaggingFetch,
  __resetEmporixClients,
} from "../src/client";

/** Captures what the tagging fetch hands the global fetch. */
function captureGlobalFetch() {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return Promise.resolve(
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );
  });
  return { calls, spy };
}

/** `next` is not part of the standard RequestInit. */
interface NextRequestInit extends RequestInit {
  next?: { tags?: string[]; revalidate?: number };
}
const nextOf = (init: RequestInit | undefined): NextRequestInit["next"] =>
  (init as NextRequestInit | undefined)?.next;

beforeEach(() => {
  __resetEmporixClients();
  process.env.EMPORIX_TENANT = "acme";
  process.env.EMPORIX_STOREFRONT_CLIENT_ID = "sf";
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.EMPORIX_TENANT;
  delete process.env.EMPORIX_STOREFRONT_CLIENT_ID;
});

describe("createTaggingFetch", () => {
  it("attaches tags and revalidate to a taggable GET", async () => {
    const { calls } = captureGlobalFetch();
    const f = createTaggingFetch({ tenant: "acme", revalidate: 60 });

    await f("https://api.emporix.io/product/acme/products/p1", { method: "GET" });

    expect(nextOf(calls[0]!.init)).toEqual({
      tags: ["emporix:product:p1", "emporix:products"],
      revalidate: 60,
    });
  });

  it("leaves a non-GET untagged", async () => {
    const { calls } = captureGlobalFetch();
    const f = createTaggingFetch({ tenant: "acme", revalidate: 60 });

    await f("https://api.emporix.io/product/acme/products/p1", { method: "POST" });

    expect(nextOf(calls[0]!.init)).toBeUndefined();
  });

  it("treats a missing method as GET, matching the fetch default", async () => {
    const { calls } = captureGlobalFetch();
    const f = createTaggingFetch({ tenant: "acme", revalidate: 60 });

    await f("https://api.emporix.io/product/acme/products/p1");

    expect(nextOf(calls[0]!.init)?.tags).toEqual(["emporix:product:p1", "emporix:products"]);
  });

  it("leaves an untaggable URL untouched", async () => {
    const { calls } = captureGlobalFetch();
    const f = createTaggingFetch({ tenant: "acme", revalidate: 60 });

    await f("https://api.emporix.io/cart/acme/carts/c1", { method: "GET" });

    expect(nextOf(calls[0]!.init)).toBeUndefined();
  });

  it("preserves the caller's other init fields", async () => {
    const { calls } = captureGlobalFetch();
    const f = createTaggingFetch({ tenant: "acme", revalidate: 60 });

    await f("https://api.emporix.io/product/acme/products/p1", {
      method: "GET",
      headers: { "x-test": "1" },
    });

    expect((calls[0]!.init?.headers as Record<string, string>)["x-test"]).toBe("1");
  });

  it("accepts a URL object, which is what the SDK passes", async () => {
    const { calls } = captureGlobalFetch();
    const f = createTaggingFetch({ tenant: "acme", revalidate: 60 });

    await f(new URL("https://api.emporix.io/product/acme/products/p1"), { method: "GET" });

    expect(nextOf(calls[0]!.init)?.tags).toContain("emporix:product:p1");
  });
});

describe("getEmporixClient", () => {
  it("memoizes per tenant+tagged+revalidate", () => {
    const a = getEmporixClient();
    const b = getEmporixClient();
    expect(a).toBe(b);

    expect(getEmporixClient({ tagged: false })).not.toBe(a);
    expect(getEmporixClient({ revalidate: 60 })).not.toBe(a);
    expect(getEmporixClient({ tenant: "other" })).not.toBe(a);

    // ...but the same options return the same instance again.
    expect(getEmporixClient({ tagged: false })).toBe(getEmporixClient({ tagged: false }));
  });

  it("throws a helpful error when the tenant is unset", () => {
    delete process.env.EMPORIX_TENANT;
    expect(() => getEmporixClient()).toThrow(/EMPORIX_TENANT/);
  });

  it("the default client tags a catalog GET end to end", async () => {
    const { calls } = captureGlobalFetch();
    const sdk = getEmporixClient();

    await sdk.products.get("p1", undefined, auth.anonymous()).catch(() => {
      // The stub answers {} for both the token and the product request; only
      // the tagging of the product request is under test.
    });

    const product = calls.find((c) => c.url.includes("/product/acme/products/p1"));
    expect(product).toBeDefined();
    expect(nextOf(product!.init)?.tags).toEqual(["emporix:product:p1", "emporix:products"]);
  });

  it("the untagged client tags nothing — the customer-token boundary", async () => {
    const { calls } = captureGlobalFetch();
    const sdk = getEmporixClient({ tagged: false });

    await sdk.products.get("p1", undefined, auth.customer("cust")).catch(() => {});

    const product = calls.find((c) => c.url.includes("/product/acme/products/p1"));
    expect(product).toBeDefined();
    expect(nextOf(product!.init)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-next exec vitest run tests/client.test.ts`
Expected: FAIL — `Failed to resolve import "../src/client"`.

- [ ] **Step 3: Write `src/client.ts`**

```ts
import { EmporixClient } from "@viu/emporix-sdk";
import { emporixTagsForUrl } from "./tags";

/** `next` is a Next.js extension to `RequestInit`, not part of the standard. */
interface NextRequestInit extends RequestInit {
  next?: { tags?: string[]; revalidate?: number };
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * A `fetch` that attaches Next cache tags to cacheable Emporix GETs and passes
 * everything else through untouched.
 *
 * Only GET is tagged — a cached mutation would be a correctness bug. Which URLs
 * are cacheable is decided by {@link emporixTagsForUrl}; cart, order, customer
 * and token endpoints map to no tags and are therefore never cached.
 *
 * This wrapper does NOT and CANNOT distinguish an anonymous from a
 * customer-scoped request: `AuthContext` is per call and both arrive as
 * `Bearer <jwt>`. Use {@link getEmporixClient} with `tagged: false` for anything
 * carrying a customer token — Next's fetch cache does not key on the
 * `Authorization` header, so a personalized response cached here would be
 * served to other visitors.
 */
export function createTaggingFetch(opts: {
  tenant: string;
  revalidate: number;
}): typeof globalThis.fetch {
  return (input, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method !== "GET") return globalThis.fetch(input, init);
    const tags = emporixTagsForUrl(urlOf(input), opts.tenant);
    if (tags.length === 0) return globalThis.fetch(input, init);
    const tagged: NextRequestInit = { ...init, next: { tags, revalidate: opts.revalidate } };
    return globalThis.fetch(input, tagged);
  };
}

export interface GetEmporixClientOptions {
  /** Default: `process.env.EMPORIX_TENANT`. */
  tenant?: string;
  /** Storefront (anonymous) client id. Default: `process.env.EMPORIX_STOREFRONT_CLIENT_ID`. */
  clientId?: string;
  /** Default: `process.env.EMPORIX_HOST`, else the SDK default. */
  host?: string;
  /**
   * Attach cache tags to cacheable GETs. Default `true`.
   * MUST be `false` for any client used with a customer token.
   */
  tagged?: boolean;
  /** Seconds, becomes `next: { revalidate }` on tagged GETs. Default 3600. */
  revalidate?: number;
}

const clients = new Map<string, EmporixClient>();

/**
 * A memoized `EmporixClient` for a Next server. One instance per distinct option
 * set, never one per request — a per-request client defeats the SDK's token
 * cache.
 *
 * The option set is deliberately narrow so the memoization key can cover all of
 * it. Need more configuration? Construct `new EmporixClient` yourself and pass
 * `fetch: createTaggingFetch({ tenant, revalidate })`.
 */
export function getEmporixClient(opts: GetEmporixClientOptions = {}): EmporixClient {
  const tenant = opts.tenant ?? process.env.EMPORIX_TENANT;
  if (!tenant) {
    throw new Error(
      "getEmporixClient: no tenant. Set EMPORIX_TENANT or pass { tenant }.",
    );
  }
  const clientId = opts.clientId ?? process.env.EMPORIX_STOREFRONT_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      "getEmporixClient: no storefront client id. Set EMPORIX_STOREFRONT_CLIENT_ID or pass { clientId }.",
    );
  }
  const host = opts.host ?? process.env.EMPORIX_HOST;
  const tagged = opts.tagged ?? true;
  const revalidate = opts.revalidate ?? 3600;

  const key = `${tenant}|${clientId}|${host ?? ""}|${tagged}|${revalidate}`;
  const cached = clients.get(key);
  if (cached) return cached;

  const client = new EmporixClient({
    tenant,
    credentials: { storefront: { clientId } },
    logger: false,
    ...(host !== undefined ? { host } : {}),
    ...(tagged ? { fetch: createTaggingFetch({ tenant, revalidate }) } : {}),
  });
  clients.set(key, client);
  return client;
}

/** Test-only: clears the memoization map so each test starts clean. */
export function __resetEmporixClients(): void {
  clients.clear();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk-next exec vitest run tests/client.test.ts`
Expected: PASS, 11 tests.

If the two end-to-end cases fail because the SDK's anonymous-token bootstrap
rejects the `{}` stub response, give the stub a real token payload for the
`/customerlogin/auth/anonymous/login` URL:

```ts
if (url.includes("/customerlogin/")) {
  return Promise.resolve(
    new Response(
      JSON.stringify({
        access_token: "anon", token_type: "Bearer", expires_in: 3599,
        refresh_token: "rt", sessionId: "s",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
}
```

Adjust the stub, never the assertion.

- [ ] **Step 5: Export from the barrel**

Append to `packages/next/src/index.ts`:

```ts
export {
  getEmporixClient,
  createTaggingFetch,
  type GetEmporixClientOptions,
} from "./client";
```

`__resetEmporixClients` stays unexported from the barrel — it is test-only.

- [ ] **Step 6: Gates**

Run: `pnpm -F @viu/emporix-sdk-next test && pnpm -F @viu/emporix-sdk-next typecheck && pnpm -F @viu/emporix-sdk-next lint`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add packages/next/src/client.ts packages/next/src/index.ts packages/next/tests/client.test.ts
git commit -m "feat(repo): add tagging fetch and memoized client to emporix-sdk-next

getEmporixClient() is tagged and cacheable for anonymous catalog reads;
getEmporixClient({ tagged: false }) is for anything with a customer token. The
boundary is explicit because the fetch wrapper provably cannot tell the two
apart, and Next's fetch cache does not key on Authorization.

Narrowed the spec's Partial<EmporixConfig> to five explicit options so the
memoization key covers all of them — arbitrary config could not be keyed and
would have silently shared instances."
```

---

## Task 4: Cookie session

**Files:**
- Create: `packages/next/src/session.ts`
- Modify: `packages/next/src/index.ts`
- Test: `packages/next/tests/session.test.ts`

**Interfaces:**
- Consumes: `createServerStorage`, `serverAuth` from `@viu/emporix-sdk-react/ssr` (shipped in `@viu/emporix-sdk-react@2.25.0`, PR #182).
- Produces:
  ```ts
  export interface EmporixServerSession {
    storage: EmporixStorage;
    auth: AuthContext;
    customerToken: string | null;
    cartId: string | null;
    siteCode: string | null;
    language: string | null;
    legalEntityId: string | null;
  }
  export function emporixSession(): Promise<EmporixServerSession>;
  export function emporixSessionMutable(opts?: {
    sameSite?: "lax" | "strict" | "none";
    secure?: boolean;
    httpOnly?: boolean;
  }): Promise<EmporixServerSession>;
  ```

- [ ] **Step 1: Write the failing test**

Create `packages/next/tests/session.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { auth } from "@viu/emporix-sdk";

/** Next's `cookies()` shape, enough of it to drive the code under test. */
interface FakeCookie {
  name: string;
  value: string;
  opts?: Record<string, unknown>;
}
const bag = new Map<string, FakeCookie>();
const jar = {
  get: (name: string) => bag.get(name),
  set: (name: string, value: string, opts?: Record<string, unknown>) => {
    bag.set(name, { name, value, ...(opts ? { opts } : {}) });
  },
  delete: (name: string) => {
    bag.delete(name);
  },
};

vi.mock("next/headers", () => ({ cookies: () => Promise.resolve(jar) }));

// Imported after the mock is registered.
const { emporixSession, emporixSessionMutable } = await import("../src/session");

beforeEach(() => bag.clear());

describe("emporixSession (read-only)", () => {
  it("reads the whole session out of the cookie jar", async () => {
    jar.set("emporix.customerToken", "cust");
    jar.set("emporix.cartId", "cart-1");
    jar.set("emporix.siteCode", "main");
    jar.set("emporix.language", "de");
    jar.set("emporix.activeLegalEntityId", "le-1");

    const s = await emporixSession();

    expect(s.customerToken).toBe("cust");
    expect(s.cartId).toBe("cart-1");
    expect(s.siteCode).toBe("main");
    expect(s.language).toBe("de");
    expect(s.legalEntityId).toBe("le-1");
    expect(s.auth).toEqual(auth.customer("cust"));
  });

  it("resolves an anonymous context and null fields on an empty jar", async () => {
    const s = await emporixSession();
    expect(s.customerToken).toBeNull();
    expect(s.cartId).toBeNull();
    expect(s.auth).toEqual(auth.anonymous());
  });

  it("is read-only: a write warns and does not touch the jar", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = await emporixSession();

    expect(() => s.storage.setCustomerToken("new")).not.toThrow();

    expect(bag.has("emporix.customerToken")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("emporixSessionMutable", () => {
  it("writes through with secure httpOnly defaults", async () => {
    const s = await emporixSessionMutable();

    s.storage.setCustomerToken("t1");

    const written = bag.get("emporix.customerToken");
    expect(written?.value).toBe("t1");
    expect(written?.opts).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
    });
  });

  it("honours overrides", async () => {
    const s = await emporixSessionMutable({ sameSite: "strict", secure: false, httpOnly: false });

    s.storage.setCartId("c1");

    expect(bag.get("emporix.cartId")?.opts).toMatchObject({
      httpOnly: false,
      sameSite: "strict",
      secure: false,
    });
  });

  it("deletes the cookie on a null write", async () => {
    jar.set("emporix.cartId", "c1");
    const s = await emporixSessionMutable();

    s.storage.setCartId(null);

    expect(bag.has("emporix.cartId")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-next exec vitest run tests/session.test.ts`
Expected: FAIL — `Failed to resolve import "../src/session"`.

- [ ] **Step 3: Write `src/session.ts`**

```ts
import { cookies } from "next/headers";
import type { AuthContext } from "@viu/emporix-sdk";
import {
  createServerStorage,
  serverAuth,
  type ServerCookieJar,
} from "@viu/emporix-sdk-react/ssr";
import type { EmporixStorage } from "@viu/emporix-sdk-react";

/** The Emporix session as it exists on the server for one request. */
export interface EmporixServerSession {
  /** Session state backed by the request's cookies. */
  storage: EmporixStorage;
  /** `auth.customer(token)` when a token is stored, else `auth.anonymous()`. */
  auth: AuthContext;
  customerToken: string | null;
  cartId: string | null;
  siteCode: string | null;
  language: string | null;
  legalEntityId: string | null;
}

function build(storage: EmporixStorage): EmporixServerSession {
  return {
    storage,
    auth: serverAuth(storage),
    customerToken: storage.getCustomerToken(),
    cartId: storage.getCartId(),
    siteCode: storage.getSiteCode(),
    language: storage.getLanguage(),
    legalEntityId: storage.getActiveLegalEntityId(),
  };
}

/**
 * The Emporix session for the current request, **read-only**.
 *
 * Use this in Server Components. Next forbids cookie writes during a render, so
 * the storage's setters no-op and warn once per key rather than throwing inside
 * a render.
 *
 * ```ts
 * const { auth, siteCode } = await emporixSession();
 * const product = await getEmporixClient().products.get(id, undefined, auth);
 * ```
 *
 * Note: pass a customer `auth` only to `getEmporixClient({ tagged: false })` —
 * see `createTaggingFetch`.
 */
export async function emporixSession(): Promise<EmporixServerSession> {
  const jar = await cookies();
  const io: ServerCookieJar = { get: (name) => jar.get(name)?.value ?? null };
  return build(createServerStorage(io));
}

/**
 * The Emporix session for the current request, **read-write**. Valid only in
 * Server Actions and Route Handlers — Next throws if a Server Component writes
 * a cookie during render.
 *
 * Defaults are `httpOnly: true, sameSite: "lax", secure: true, path: "/"`.
 *
 * Caveat worth knowing before you use it for the customer token: an `httpOnly`
 * cookie cannot be read by the browser-side `createCookieStorage`, so the React
 * provider will mount unauthenticated. The supported pattern stays reading the
 * cookie on the server and passing `initialCustomerToken` into the provider.
 */
export async function emporixSessionMutable(
  opts: {
    sameSite?: "lax" | "strict" | "none";
    secure?: boolean;
    httpOnly?: boolean;
  } = {},
): Promise<EmporixServerSession> {
  const jar = await cookies();
  const attrs = {
    httpOnly: opts.httpOnly ?? true,
    sameSite: opts.sameSite ?? ("lax" as const),
    secure: opts.secure ?? true,
    path: "/",
  };
  const io: ServerCookieJar = {
    get: (name) => jar.get(name)?.value ?? null,
    set: (name, value) => {
      if (value === null) jar.delete(name);
      else jar.set(name, value, attrs);
    },
  };
  return build(createServerStorage(io));
}
```

Both imports are verified, not assumed: `EmporixStorage` is a type export of the
`@viu/emporix-sdk-react` root (`packages/react/src/index.ts:3`, present in the
built `dist/index.d.ts`), and `createServerStorage` / `serverAuth` /
`ServerCookieJar` are exports of the `./ssr` entry (`packages/react/src/ssr.ts`,
shipped in 2.25.0).

Note the split: the *type* comes from the root, the *functions* from `./ssr`.
That is deliberate — `./ssr` is the only entry without a `"use client"` banner,
but a type import erases at compile time and so is safe from either.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk-next exec vitest run tests/session.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Export from the barrel**

Append to `packages/next/src/index.ts`:

```ts
export {
  emporixSession,
  emporixSessionMutable,
  type EmporixServerSession,
} from "./session";
```

- [ ] **Step 6: Gates**

Run: `pnpm -F @viu/emporix-sdk-next test && pnpm -F @viu/emporix-sdk-next typecheck && pnpm -F @viu/emporix-sdk-next lint && pnpm -F @viu/emporix-sdk-next build`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add packages/next/src/session.ts packages/next/src/index.ts packages/next/tests/session.test.ts
git commit -m "feat(repo): add cookie session helpers to emporix-sdk-next

emporixSession() is read-only for Server Components; emporixSessionMutable()
writes with httpOnly/secure/lax defaults for Server Actions and Route Handlers.
Both are thin wrappers over createServerStorage + serverAuth from the react ssr
entry, so no storefront writes the jar adapter or the cookie attributes again."
```

---

## Task 5: Webhook route — CONDITIONAL

**This task starts with a measurement, and the measurement decides whether the task happens at all.**

The Emporix docs say the signature is HMAC-SHA256 *«encoded to `BASE256`»*. BASE256 is not a real encoding. Shipping a verifier against a guessed encoding produces either something that rejects every delivery, or — if you add a try-several-encodings fallback — something materially weaker than it appears. Neither is acceptable on a security boundary.

**Files:**
- Create: `packages/next/src/webhook.ts`
- Modify: `packages/next/tsup.config.ts`, `packages/next/package.json` (restore the `webhook` entry removed in Task 2)
- Test: `packages/next/tests/webhook.test.ts`

**Interfaces:**
- Consumes: `emporixTags` (Task 2).
- Produces:
  ```ts
  export interface EmporixWebhookEvent {
    type: string;
    payload: Record<string, unknown>;
  }
  export function verifyEmporixSignature(
    rawBody: string,
    signatureHeader: string | null,
    secret: string,
    opts?: { encoding?: "base64" | "hex" },
  ): boolean;
  export function createEmporixWebhookRoute(opts: {
    secret: string;
    onEvent?: (event: EmporixWebhookEvent) => Promise<void> | void;
    maxAgeSeconds?: number;
  }): (req: Request) => Promise<Response>;
  ```

- [ ] **Step 1: Measure the real signature encoding**

Configure an HTTP webhook on the `viu` tenant pointing at a request inspector you control, with a known `secretKey`. Trigger a `product.updated` event. Capture the raw request body **byte for byte** plus the `emporix-event-signature` and `emporix-event-publish-time` headers.

Then compute, locally, over the exact captured bytes:

```
HMAC-SHA256(secret, rawBody) → base64
HMAC-SHA256(secret, rawBody) → hex
```

and compare each against the captured header. Record which matched, and record whether the header carries a bare value or a prefixed one (`sha256=…`, `v1,…`).

Credentials for this step must come from the environment and must never be committed or printed.

**Decision rule — apply it literally:**

- **A candidate matched** → note it in the commit message and continue at Step 2 with that encoding as the default.
- **Nothing matched, or the capture cannot be performed** (no tenant admin access, no publicly reachable inspector) → **STOP. Delete this task.** Ship v0.1 with Tasks 1–4, leave the `webhook` entry out of `tsup.config.ts` and `package.json` exports, and record in the PR description that Component 3 is deferred to v0.2 pending the measurement. Tasks 1–4 do not depend on it. **Do not implement a verifier on a guess, and do not add an encoding-fallback loop.**

Also capture the real event body shape here — `EmporixWebhookEvent` is typed from what was observed, not from an assumed schema. If the body nests the entity under a different key than `payload`, use the real key.

- [ ] **Step 2: Write the failing test**

Create `packages/next/tests/webhook.test.ts`. Replace `MEASURED_ENCODING` with the value from Step 1 and the fixture body with the captured shape:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";

const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({ revalidateTag: (t: string) => revalidateTag(t) }));

const { verifyEmporixSignature, createEmporixWebhookRoute } = await import("../src/webhook");

const SECRET = "whsec_test";
const MEASURED_ENCODING = "base64" as const; // ← from Step 1

function sign(body: string, secret = SECRET): string {
  return createHmac("sha256", secret).update(body).digest(MEASURED_ENCODING);
}

function req(body: string, headers: Record<string, string> = {}): Request {
  return new Request("https://storefront.example/api/emporix/webhook", {
    method: "POST",
    body,
    headers: {
      "emporix-event-signature": sign(body),
      "emporix-event-publish-time": new Date().toISOString(),
      ...headers,
    },
  });
}

const PRODUCT_UPDATED = JSON.stringify({
  type: "product.updated",
  payload: { id: "p1" },
});

beforeEach(() => revalidateTag.mockClear());

describe("verifyEmporixSignature", () => {
  it("accepts a correct signature", () => {
    expect(verifyEmporixSignature(PRODUCT_UPDATED, sign(PRODUCT_UPDATED), SECRET)).toBe(true);
  });

  it("rejects a wrong signature", () => {
    expect(verifyEmporixSignature(PRODUCT_UPDATED, sign(PRODUCT_UPDATED, "other"), SECRET)).toBe(
      false,
    );
  });

  it("rejects a missing signature", () => {
    expect(verifyEmporixSignature(PRODUCT_UPDATED, null, SECRET)).toBe(false);
  });

  it("rejects a signature of a different body — no length-only comparison", () => {
    const other = JSON.stringify({ type: "product.updated", payload: { id: "p2" } });
    expect(verifyEmporixSignature(PRODUCT_UPDATED, sign(other), SECRET)).toBe(false);
  });

  it("rejects a truncated signature without throwing", () => {
    expect(() =>
      verifyEmporixSignature(PRODUCT_UPDATED, sign(PRODUCT_UPDATED).slice(0, 5), SECRET),
    ).not.toThrow();
    expect(verifyEmporixSignature(PRODUCT_UPDATED, sign(PRODUCT_UPDATED).slice(0, 5), SECRET)).toBe(
      false,
    );
  });
});

describe("createEmporixWebhookRoute", () => {
  it("revalidates the product tags on a valid product.updated", async () => {
    const route = createEmporixWebhookRoute({ secret: SECRET });

    const res = await route(req(PRODUCT_UPDATED));

    expect(res.status).toBe(200);
    expect(revalidateTag.mock.calls.flat()).toEqual([
      "emporix:product:p1",
      "emporix:products",
    ]);
  });

  it("returns 401 and revalidates nothing on a bad signature", async () => {
    const route = createEmporixWebhookRoute({ secret: SECRET });

    const res = await route(
      req(PRODUCT_UPDATED, { "emporix-event-signature": sign(PRODUCT_UPDATED, "wrong") }),
    );

    expect(res.status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("returns 401 for a delivery older than maxAgeSeconds", async () => {
    const route = createEmporixWebhookRoute({ secret: SECRET, maxAgeSeconds: 300 });
    const old = new Date(Date.now() - 600_000).toISOString();

    const res = await route(req(PRODUCT_UPDATED, { "emporix-event-publish-time": old }));

    expect(res.status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("accepts a delivery inside the window", async () => {
    const route = createEmporixWebhookRoute({ secret: SECRET, maxAgeSeconds: 300 });
    const recent = new Date(Date.now() - 60_000).toISOString();

    const res = await route(req(PRODUCT_UPDATED, { "emporix-event-publish-time": recent }));

    expect(res.status).toBe(200);
  });

  it("calls onEvent after revalidating", async () => {
    const seen: string[] = [];
    const route = createEmporixWebhookRoute({
      secret: SECRET,
      onEvent: (e) => {
        seen.push(e.type);
      },
    });

    await route(req(PRODUCT_UPDATED));

    expect(seen).toEqual(["product.updated"]);
  });

  it("returns 500 when onEvent throws, so Emporix retries", async () => {
    const route = createEmporixWebhookRoute({
      secret: SECRET,
      onEvent: () => {
        throw new Error("downstream down");
      },
    });

    const res = await route(req(PRODUCT_UPDATED));

    expect(res.status).toBe(500);
  });

  it("returns 200 without revalidating for an unmapped event type", async () => {
    const route = createEmporixWebhookRoute({ secret: SECRET });
    const body = JSON.stringify({ type: "some.unmapped.event", payload: {} });

    const res = await route(req(body));

    expect(res.status).toBe(200);
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-next exec vitest run tests/webhook.test.ts`
Expected: FAIL — `Failed to resolve import "../src/webhook"`.

- [ ] **Step 4: Write `src/webhook.ts`**

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { emporixTags } from "./tags";

/** An Emporix webhook delivery. Shape confirmed against a real delivery. */
export interface EmporixWebhookEvent {
  type: string;
  payload: Record<string, unknown>;
}

/**
 * Verifies the `emporix-event-signature` header: HMAC-SHA256 over the raw body
 * with the configured `secretKey`.
 *
 * `rawBody` must be the exact bytes received. Re-serializing the parsed JSON
 * changes key order and whitespace and breaks the HMAC.
 *
 * The default encoding was determined by measuring a real delivery from the viu
 * tenant; the Emporix docs describe it as "BASE256", which is not a real
 * encoding. Override `encoding` only if a tenant proves to differ.
 */
export function verifyEmporixSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  opts: { encoding?: "base64" | "hex" } = {},
): boolean {
  if (signatureHeader === null || signatureHeader === "") return false;
  const encoding = opts.encoding ?? "base64";
  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody).digest(encoding));
  const received = Buffer.from(signatureHeader);
  // timingSafeEqual throws on a length mismatch, which is itself a rejection.
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

/** Maps an event type + payload to the cache tags it invalidates. */
function tagsForEvent(event: EmporixWebhookEvent): string[] {
  const id = typeof event.payload.id === "string" ? event.payload.id : undefined;
  if (event.type.startsWith("product.")) {
    return id ? [emporixTags.product(id), emporixTags.products] : [emporixTags.products];
  }
  if (event.type.startsWith("category.")) {
    return id ? [emporixTags.category(id), emporixTags.categories] : [emporixTags.categories];
  }
  if (event.type.startsWith("price.")) return [emporixTags.prices];
  if (event.type.startsWith("availability.")) return [emporixTags.availability];
  return [];
}

/**
 * A Next Route Handler that verifies an Emporix webhook and invalidates the
 * matching cache tags.
 *
 * ```ts
 * // app/api/emporix/webhook/route.ts
 * import { createEmporixWebhookRoute } from "@viu/emporix-sdk-next/webhook";
 * export const POST = createEmporixWebhookRoute({
 *   secret: process.env.EMPORIX_WEBHOOK_SECRET!,
 *   maxAgeSeconds: 300,
 * });
 * ```
 *
 * A signature or replay-window failure returns 401 and revalidates nothing. A
 * throwing `onEvent` returns 500 so Emporix retries the delivery.
 */
export function createEmporixWebhookRoute(opts: {
  secret: string;
  /** Runs after revalidation. Throwing returns 500 and Emporix retries. */
  onEvent?: (event: EmporixWebhookEvent) => Promise<void> | void;
  /** Reject deliveries older than this, per `emporix-event-publish-time`. */
  maxAgeSeconds?: number;
}): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const rawBody = await req.text();
    if (!verifyEmporixSignature(rawBody, req.headers.get("emporix-event-signature"), opts.secret)) {
      return new Response("invalid signature", { status: 401 });
    }

    if (opts.maxAgeSeconds !== undefined) {
      const publishedAt = req.headers.get("emporix-event-publish-time");
      const publishedMs = publishedAt === null ? NaN : Date.parse(publishedAt);
      if (Number.isNaN(publishedMs)) {
        return new Response("missing or unparseable publish time", { status: 401 });
      }
      if (Date.now() - publishedMs > opts.maxAgeSeconds * 1000) {
        return new Response("delivery too old", { status: 401 });
      }
    }

    let event: EmporixWebhookEvent;
    try {
      event = JSON.parse(rawBody) as EmporixWebhookEvent;
    } catch {
      return new Response("unparseable body", { status: 400 });
    }

    for (const tag of tagsForEvent(event)) {
      revalidateTag(tag);
    }

    if (opts.onEvent) {
      try {
        await opts.onEvent(event);
      } catch {
        return new Response("handler failed", { status: 500 });
      }
    }

    return new Response(null, { status: 200 });
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk-next exec vitest run tests/webhook.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 6: Restore the `webhook` build entry**

Add `webhook: "src/webhook.ts"` back to `entry` in `packages/next/tsup.config.ts`, and the `"./webhook"` block back to `exports` in `packages/next/package.json` (both were removed in Task 2 Step 8).

Run: `pnpm -F @viu/emporix-sdk-next build`
Expected: `dist/webhook.js`, `dist/webhook.cjs`, `dist/webhook.d.ts` all present.

`src/webhook.ts` must **not** be re-exported from `src/index.ts` — keeping it on
its own entry is why a route handler does not pull the client and session code.

- [ ] **Step 7: Gates and commit**

Run: `pnpm -F @viu/emporix-sdk-next test && pnpm -F @viu/emporix-sdk-next typecheck && pnpm -F @viu/emporix-sdk-next lint`

```bash
git add packages/next/src/webhook.ts packages/next/tests/webhook.test.ts \
        packages/next/tsup.config.ts packages/next/package.json
git commit -m "feat(repo): add webhook signature verification and tag revalidation

Signature encoding was measured against a real delivery from the viu tenant
rather than guessed — the Emporix docs describe it as BASE256, which is not a
real encoding. Comparison is timingSafeEqual over equal-length buffers.

401 on a bad signature or a stale publish time, revalidating nothing; 500 when
onEvent throws so Emporix retries."
```

---

## Task 6: README, changeset, PR

**Files:**
- Create: `packages/next/README.md`, `.changeset/emporix-sdk-next-initial.md`
- Modify: `README.md` (root packages table), `CLAUDE.md` (workspace layout table), `docs/react.md` (pointer)

**Interfaces:**
- Consumes: everything from Tasks 2–5.

- [ ] **Step 1: Write `packages/next/README.md`**

````markdown
# @viu/emporix-sdk-next

Next.js server-side bindings for [`@viu/emporix-sdk`](../sdk): cache tags,
cookie session, and webhook-driven revalidation. Server-only — every export
uses `next/headers` or `next/cache`.

## Install

```bash
pnpm add @viu/emporix-sdk-next @viu/emporix-sdk @viu/emporix-sdk-react next
```

All four are peer dependencies. This package has no runtime dependencies.

## The one rule

**A customer token never goes through the tagged client.**

```ts
getEmporixClient()                    // tagged + cacheable — anonymous catalog reads
getEmporixClient({ tagged: false })   // untagged — anything with a customer token
```

Next's fetch cache does not key on the `Authorization` header, so a
customer-scoped response cached by the tagged client would be served to other
visitors. The package cannot detect this for you: `AuthContext` is per call and
anonymous and customer tokens both arrive as `Bearer <jwt>`.

## Server Component

```tsx
import { getEmporixClient, emporixSession } from "@viu/emporix-sdk-next";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { auth, siteCode } = await emporixSession();
  const sdk = getEmporixClient();                       // memoized per process
  const product = await sdk.products.get(id, undefined, auth);
  return <h1>{product.name}</h1>;
}
```

Catalog GETs are tagged automatically — `emporix:product:{id}` and
`emporix:products` here. Cart, order, customer and token requests are never
tagged and therefore never cached.

## Server Action

```ts
"use server";
import { emporixSessionMutable, getEmporixClient } from "@viu/emporix-sdk-next";

export async function login(formData: FormData) {
  const { storage } = await emporixSessionMutable();     // httpOnly, secure, lax
  const sdk = getEmporixClient({ tagged: false });
  const session = await sdk.customers.login({
    email: String(formData.get("email")),
    password: String(formData.get("password")),
  });
  storage.setCustomerToken(session.customerToken);
}
```

`emporixSession()` is read-only, because Next forbids cookie writes during a
render; a write attempt warns once per key instead of throwing.

## Webhook revalidation

```ts
// app/api/emporix/webhook/route.ts
import { createEmporixWebhookRoute } from "@viu/emporix-sdk-next/webhook";

export const POST = createEmporixWebhookRoute({
  secret: process.env.EMPORIX_WEBHOOK_SECRET!,
  maxAgeSeconds: 300,
});
```

Verifies `emporix-event-signature` (HMAC-SHA256 over the raw body), checks
`emporix-event-publish-time` against the window, then calls `revalidateTag` for
each affected tag. 401 on failure, revalidating nothing.

## Cache tags

| Read | Tags |
| --- | --- |
| one product | `emporix:product:{id}`, `emporix:products` |
| product listing / search | `emporix:products` |
| one category (+ subcategories, parents) | `emporix:category:{id}`, `emporix:categories` |
| category tree | `emporix:category-tree:{id}`, `emporix:categories` |
| prices | `emporix:prices` |
| availability | `emporix:availability` |
| sites | `emporix:sites` |

Construct them yourself with `emporixTags`.

## Environment

`EMPORIX_TENANT`, `EMPORIX_STOREFRONT_CLIENT_ID`, optionally `EMPORIX_HOST`.

## Footgun: `httpOnly` and the browser

An `httpOnly` customer-token cookie cannot be read by the browser-side
`createCookieStorage`, so `<EmporixProvider>` mounts unauthenticated. The
supported pattern is to read the cookie on the server and pass
`initialCustomerToken` into the provider — see
[`../../docs/react.md`](../../docs/react.md).

## `next/image`

Emporix media has no documented transform parameters; PUBLIC assets resolve to a
storage URL. There is no custom loader to install — add the storage host to
`images.remotePatterns` in `next.config.mjs` and use `next/image` normally.

## License

MIT — see [LICENSE](./LICENSE).
````

- [ ] **Step 2: Update the root README and CLAUDE.md**

In `README.md`, add to the packages table after the `@viu/emporix-mixins` row:

```markdown
| [`@viu/emporix-sdk-next`](./packages/next) | Next.js server-side bindings: URL-derived cache tags, cookie session for RSC and Server Actions, webhook-driven `revalidateTag` |
```

Add the npm badge next to the other three:

```markdown
[![@viu/emporix-sdk-next](https://img.shields.io/npm/v/@viu/emporix-sdk-next?label=%40viu%2Femporix-sdk-next)](https://www.npmjs.com/package/@viu/emporix-sdk-next)
```

In `CLAUDE.md`, add to the workspace-layout table after the `packages/mixins` row:

```markdown
| `packages/next` | Next.js server bindings: cache tags (`emporixTags`), `getEmporixClient`, `emporixSession`, webhook route | yes (`@viu/emporix-sdk-next`) |
```

In `docs/react.md`, at the end of the *Server-side session* subsection, add:

```markdown
Next.js apps can skip this wiring entirely — `@viu/emporix-sdk-next` ships
`emporixSession()` / `emporixSessionMutable()` over `next/headers`, plus a
memoized client and cache tags. See [`../packages/next/README.md`](../packages/next/README.md).
```

- [ ] **Step 3: Write the changeset**

`.changeset/emporix-sdk-next-initial.md`:

```markdown
---
"@viu/emporix-sdk-next": minor
---

Initial release. Next.js server-side bindings for the Emporix SDK.

- `getEmporixClient()` — a memoized `EmporixClient` per process (never per
  request) whose `fetch` attaches Next cache tags to cacheable catalog GETs.
  `getEmporixClient({ tagged: false })` is the untagged variant and is required
  for anything carrying a customer token: Next's fetch cache does not key on the
  `Authorization` header.
- `emporixSession()` / `emporixSessionMutable()` — the Emporix session from
  `next/headers` cookies, read-only for Server Components and read-write with
  `httpOnly`/`secure`/`lax` defaults for Server Actions and Route Handlers.
- `emporixTags` / `emporixTagsForUrl` — the tag vocabulary and the URL mapping.
  Tags are derived centrally from the request URL rather than passed per call,
  because the SDK has 596 request call sites.
- `@viu/emporix-sdk-next/webhook` — `verifyEmporixSignature` (HMAC-SHA256 over
  the raw body, `timingSafeEqual`) and `createEmporixWebhookRoute`, which
  revalidates the affected tags.

Requires `@viu/emporix-sdk` with `EmporixConfig.fetch`.
```

If Task 5 was dropped at its Step 1, delete the `/webhook` bullet from this
changeset and from the README.

- [ ] **Step 4: Full repo gates**

Run: `pnpm -r test && pnpm typecheck && pnpm lint && pnpm -r --filter "./packages/*" build`
Expected: all clean. Confirm the new package appears in the `-r` output — proof that the glob-based tooling needed no configuration change.

- [ ] **Step 5: Verify the published surface**

Run: `cd packages/next && pnpm pack --dry-run 2>&1 | tail -30`
Expected: `dist/`, `README.md`, `LICENSE` — and **no `src/`**.

Run: `node -e "console.log(Object.keys(require('./packages/next/package.json').exports))"` from the repo root.
Expected: `[ '.', './webhook', './package.json' ]` — or `[ '.', './package.json' ]` if Task 5 was dropped.

- [ ] **Step 6: Commit, push, open PR 2**

```bash
git add packages/next/README.md .changeset/emporix-sdk-next-initial.md \
        README.md CLAUDE.md docs/react.md
git commit -m "docs(repo): document the emporix-sdk-next package

README with the one rule that matters (a customer token never goes through the
tagged client), the tag table, and the httpOnly footgun. Root README, CLAUDE.md
and docs/react.md point at it."
git push origin feat/emporix-sdk-next
```

The PR body must state: new package at 0.1.0, deliberately not in the changesets
`linked` group; zero workflow or root-config changes because the tooling is
glob-based; requires the `EmporixConfig.fetch` minor from PR 1; whether Task 5
shipped or was deferred, and why.

---

## Follow-ups (explicitly NOT in this plan)

1. **Migrate `examples/next-app-router` onto the package.** It is the real
   acceptance test for whether this surface is pleasant, and it removes that
   example's duplicated cookie-name literal and its two module-scope
   `EmporixClient` instances.
2. **Middleware** for site/locale detection, on request.
3. **`docs/nextjs.md`** with the `images.remotePatterns` entry.
4. **Key normalization in `@viu/emporix-sdk-react`** — still open from the
   previous cycle: move `useAvailability` / `useAvailabilities` onto `emporixKey`
   and fix the `prefetchOrder` / `useOrder` `authKind` mismatch. Both invalidate
   consumer caches, so they belong together in their own PR.
5. **Share the eight storage-key literals** between `storage/cookie-core.ts` and
   `storage/web-storage.ts` in the react package — noted during the previous
   cycle and still duplicated.
