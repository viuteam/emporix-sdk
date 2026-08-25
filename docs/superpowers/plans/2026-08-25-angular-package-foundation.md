# Angular Package Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@viu/emporix-sdk-angular` as a decorator-free, tsup-built package whose `provideEmporix`, `injectEmporixQuery`, `storageSignal` and site/customer-session signals are proven inside a real Angular 22 AOT production build.

**Architecture:** Angular's DI replaces React's context tree — `InjectionToken`s behind one `provideEmporix()` that composes `provideTanStackQuery` internally. React's render-time recomputation is replaced by signals read *inside* `injectQuery`'s options callback, which TanStack runs in a reactive context. The auth/key/gate logic is lifted out of the injectable into a pure `emporixQueryOptions()` function, which is testable without any Angular runtime — a shape React's Rules of Hooks forbid.

**Tech Stack:** Angular 22.1.x (peer `>=20.0.0 <23.0.0`), `@tanstack/angular-query-experimental` 5.102.x, TypeScript 5.6+, tsup, Vitest + jsdom + MSW, pnpm workspaces, changesets.

**Spec:** [`docs/superpowers/specs/2026-08-25-angular-package-design.md`](../specs/2026-08-25-angular-package-design.md)

## Scope of this plan

The spec defines eight phases. **This plan covers phases 1–3 only** — the foundation.

That is a deliberate split, not a shortcut. Phases 4–7 are 33 injectables written against one pattern, and the shape of every one of their tests depends on a question this plan settles empirically in Task 1 (which Angular test harness works under Vitest). Writing 33 injectables' worth of test code before that answer exists means writing it twice. Phases 4–8 get their own plan, authored after Task 6 lands.

What this plan delivers is working, usable software on its own: a consumer can `provideEmporix(...)`, write their own queries through `injectEmporixQuery`, read and switch the active site, and log a customer in — all with no token-freshness or cache-key bugs, and all proven against a real production build.

**Deliberately deferred out of phase 3, and why:**

- **Telemetry** (`onTelemetry`, `EmporixTelemetryEvent`). React's union is a React-Query lifecycle (`cache.hit`, `query.refetch`); porting it is a design question of its own, and nothing in the foundation needs it.
- **Customer-token auto-refresh** (`autoRefreshCustomerToken`). Opt-in and **default `false`** in React, so a foundation without it matches React's default behaviour exactly.
- **Company / B2B context.** 17 of the excluded 74 injectables; the largest single area and independent of everything here.

## Global Constraints

Copied verbatim from the spec. Every task's requirements implicitly include this section.

- **No decorators, ever, in `packages/angular/src`.** No `@Injectable()`, `@Component()`, `@Directive()`, `@Pipe()`, `@NgModule()`, `@Input()`. Only `InjectionToken`, `inject()`, `signal`/`computed`, `makeEnvironmentProviders`, and plain classes behind `{ provide: X, useClass: Y }`. This is what lets tsup replace `ng-packagr`; Task 2 enforces it with a test. **The example app in `examples/angular-storefront` is exempt** — it is compiled by the Angular CLI and needs a root `@Component`.
- **Peer versions:** `@angular/core` and `@angular/common` `>=20.0.0 <23.0.0`; `@tanstack/angular-query-experimental` `^5.102.0`; `@viu/emporix-sdk` `workspace:^`.
- **ESM only.** No CJS output, no `require` condition in `exports`.
- **Entries:** `.`, `./storage`, `./ssr`. No more.
- **Everything written into the repo is English** — code comments, JSDoc, changesets, commit messages, test names, docs prose. No exceptions.
- **Commit scope must be `angular`, `sdk`, `react`, `repo`, `docs` or `examples`**, and the first word after the scope must be a lowercase verb. `commitlint` rejects anything else via `.husky/commit-msg`.
- **TypeScript settings are repo-wide and strict:** `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`, `verbatimModuleSyntax: true`, `isolatedModules: true`. `exactOptionalPropertyTypes` in particular means an optional property must be *omitted*, not set to `undefined` — hence the `...(x !== undefined ? { x } : {})` idiom throughout the existing packages.
- **No default exports.** `eslint.config.js` forbids them via `no-restricted-syntax`.
- **`no-console: error`** and **`@typescript-eslint/no-explicit-any: error`**.
- **One changeset per PR**, describing the user-visible effect. The package starts at `0.x` under `minor`.

---

## File Structure

**New package — `packages/angular/`**

| File | Responsibility |
|---|---|
| `package.json` | manifest: peers, ESM-only exports, scripts |
| `tsconfig.json` | extends `../../tsconfig.base.json`, adds `lib: ["ES2022", "DOM"]` |
| `tsup.config.ts` | three entries, ESM only, externals |
| `eslint.config.js` | repo rules minus the React-hooks plugin |
| `vitest.config.ts` | jsdom, SDK source alias, coverage thresholds |
| `vitest.setup.ts` | Angular test environment + undici realm pinning |
| `scripts/check-dist.mjs` | fails the build if the Angular compiler touched `dist/` |
| `LICENSE`, `README.md` | required by `files` and `license` |
| `src/tokens.ts` | `EMPORIX_CLIENT`, `EMPORIX_STORAGE`, `EMPORIX_SITE` |
| `src/provide.ts` | `provideEmporix`, `injectEmporix`, `applyEmporixQueryDefaults` |
| `src/query-options.ts` | `emporixQueryOptions` — pure, no Angular import |
| `src/storage-signal.ts` | `storageSignal`, `customerTokenSignal`, `cartIdSignal` |
| `src/inject-query.ts` | `injectEmporixQuery`, `injectEmporixInfinite` |
| `src/site.ts` | site signals: read side + mount derivation |
| `src/site-switch.ts` | site signals: `setSite`, `setCurrency`, `setLanguage` |
| `src/customer-session.ts` | `injectCustomerSession` |
| `src/index.ts`, `src/storage.ts`, `src/ssr.ts` | the three entry barrels |

**Moved into `packages/sdk/` (Task 3)**

| File | Contents |
|---|---|
| `src/core/browser-storage.ts` | `createListenerSet` + the four browser backends, 251 lines lifted from `packages/react/src/storage/` |
| `src/core/query-keys.ts` | `emporixKey`, `siteMeta`, `SiteFields` |
| `src/core/customer-session-store.ts` | `getCustomerSessionStore`, `CustomerSessionState`, `CustomerSessionStore` |

**Modified**

| File | Change |
|---|---|
| `commitlint.config.js` | add `angular` to `scope-enum` |
| `.github/workflows/pr-check.yml` | decorator guard + AOT production build |
| `packages/react/src/storage/*.ts`, `hooks/internal/query-keys.ts`, `hooks/internal/customer-session-store.ts` | become re-exports |
| `packages/sdk/src/index.ts` | export the three moved modules |
| `CLAUDE.md`, `README.md`, `examples/README.md`, new `docs/angular.md` | documentation |

**New example — `examples/angular-storefront/`**, package name `@viu/emporix-examples-angular` so `.changeset/config.json`'s `ignore: ["@viu/emporix-examples-*"]` glob keeps it unpublished.

---

## Task 1: Scaffold, test harness, `provideEmporix`

The commitlint scope comes first because **no commit in this series lands without it** — `.husky/commit-msg` rejects unknown scopes, and `angular` is not among the 21 currently allowed.

Step 2 stands up the Angular test harness as the package's very first test. Everything downstream assumes it, so it gets resolved empirically before any product code exists rather than being discovered broken in Task 6.

**Files:**
- Modify: `commitlint.config.js`
- Create: `packages/angular/package.json`, `tsconfig.json`, `tsup.config.ts`, `eslint.config.js`, `vitest.config.ts`, `vitest.setup.ts`, `LICENSE`, `README.md`
- Create: `packages/angular/src/tokens.ts`, `src/provide.ts`, `src/index.ts`
- Test: `packages/angular/tests/harness.test.ts`, `packages/angular/tests/provide.test.ts`

**Interfaces:**
- Consumes: `EmporixClient`, `EmporixStorage`, `EmporixNotFoundError` from `@viu/emporix-sdk`; `createMemoryStorage` from `@viu/emporix-sdk-react` **temporarily** — Task 3 moves it into the SDK and Task 3 updates this import. Note the temporary edge in the code comment so it is not mistaken for the final shape.
- Produces:
  - `EMPORIX_CLIENT: InjectionToken<EmporixClient>`
  - `EMPORIX_STORAGE: InjectionToken<EmporixStorage>`
  - `provideEmporix(config: EmporixConfig): EnvironmentProviders`
  - `injectEmporix(): { client: EmporixClient; storage: EmporixStorage }`
  - `applyEmporixQueryDefaults(qc: QueryClient): void`
  - `interface EmporixConfig { client; storage?; queryClient? }`

---

- [ ] **Step 1: Add the `angular` commit scope**

Modify `commitlint.config.js` — insert `"angular"` directly after `"react"`:

```js
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      2,
      "always",
      ["repo", "release", "sdk", "react", "angular", "core", "customer", "product", "category", "cart", "checkout", "payment", "price", "media", "segment", "availability", "auth", "http", "logger", "deps", "docs", "examples"]
    ]
  }
};
```

- [ ] **Step 2: Create the package manifest**

Create `packages/angular/package.json`. Note `@angular/compiler` and `zone.js` are **devDependencies only** — they exist for `TestBed` and never reach `dist/`.

```json
{
  "name": "@viu/emporix-sdk-angular",
  "version": "0.0.0",
  "description": "Angular bindings for the Emporix SDK: signal-based injectables over TanStack Query",
  "license": "MIT",
  "author": { "name": "viu", "url": "https://github.com/viuteam" },
  "homepage": "https://github.com/viuteam/emporix-sdk/tree/main/packages/angular#readme",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/viuteam/emporix-sdk.git",
    "directory": "packages/angular"
  },
  "bugs": { "url": "https://github.com/viuteam/emporix-sdk/issues" },
  "keywords": ["emporix", "ecommerce", "commerce", "angular", "signals", "tanstack-query", "typescript", "storefront"],
  "type": "module",
  "sideEffects": false,
  "engines": { "node": ">=20.19.0" },
  "files": ["dist", "README.md", "CHANGELOG.md", "LICENSE"],
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./storage": { "types": "./dist/storage.d.ts", "import": "./dist/storage.js" },
    "./ssr": { "types": "./dist/ssr.d.ts", "import": "./dist/ssr.js" },
    "./package.json": "./package.json"
  },
  "publishConfig": { "access": "public", "provenance": true },
  "scripts": {
    "build": "rm -rf dist && tsup",
    "check:dist": "node scripts/check-dist.mjs",
    "test": "vitest run --coverage",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "@angular/common": ">=20.0.0 <23.0.0",
    "@angular/core": ">=20.0.0 <23.0.0",
    "@tanstack/angular-query-experimental": "^5.102.0",
    "@viu/emporix-sdk": "workspace:^"
  },
  "devDependencies": {
    "@angular/common": "^22.1.3",
    "@angular/compiler": "^22.1.3",
    "@angular/core": "^22.1.3",
    "@angular/platform-browser": "^22.1.3",
    "@tanstack/angular-query-experimental": "^5.102.3",
    "@types/node": "^24.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "@vitest/coverage-v8": "^3.2.7",
    "@viu/emporix-sdk": "workspace:*",
    "@viu/emporix-sdk-react": "workspace:*",
    "eslint": "^9.0.0",
    "jsdom": "^25.0.0",
    "msw": "^2.4.0",
    "tsup": "^8.2.0",
    "typescript": "^5.6.0",
    "undici": "^6.28.0",
    "vitest": "^3.2.7",
    "zone.js": "^0.16.0"
  }
}
```

- [ ] **Step 3: Create the remaining config files**

`packages/angular/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "lib": ["ES2022", "DOM"],
    "types": ["node"],
    "experimentalDecorators": false,
    "emitDecoratorMetadata": false
  },
  "include": ["src", "tests", "vitest.setup.ts"]
}
```

`packages/angular/tsup.config.ts`:

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    storage: "src/storage.ts",
    ssr: "src/ssr.ts",
  },
  // ESM only. @angular/core publishes no `main` and the TanStack Angular
  // adapter is ESM-only; Angular applications always bundle. A CJS half would
  // exist for no consumer.
  format: ["esm"],
  dts: true,
  sourcemap: true,
  treeshake: true,
  clean: false,
  external: [
    "@angular/core",
    "@angular/common",
    "@tanstack/angular-query-experimental",
    "@viu/emporix-sdk",
  ],
});
```

`packages/angular/eslint.config.js` — the repo rules without React's hooks plugin, plus one rule that makes the no-decorator constraint fail at lint time rather than only at `check:dist`:

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
        { selector: "ExportDefaultDeclaration", message: "No default exports — use named exports." },
        {
          selector: "Decorator",
          message:
            "No decorators in this package. Decorators require the Angular compiler, and this package is built with tsup precisely because it has none. See docs/superpowers/specs/2026-08-25-angular-package-design.md.",
        },
      ],
    },
  },
];
```

`packages/angular/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // Test-only: resolve the package to sdk source so tests need no prebuild.
      // Shipped code still imports the package name.
      "@viu/emporix-sdk": fileURLToPath(new URL("../sdk/src/index.ts", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    environmentOptions: {
      // https origin so Secure cookies persist; node export conditions so MSW v2
      // and undici share one AbortSignal/fetch realm.
      jsdom: { url: "https://localhost/", customExportConditions: ["node"] },
    },
    setupFiles: ["./vitest.setup.ts"],
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/index.ts", "src/storage.ts", "src/ssr.ts"],
      thresholds: { lines: 80, branches: 80 },
    },
  },
});
```

Copy `packages/react/LICENSE` to `packages/angular/LICENSE` verbatim. Create a one-paragraph `packages/angular/README.md`; Task 9 fills it out.

- [ ] **Step 4: Write the harness smoke test**

This test has one job: prove `TestBed` works under Vitest before any product code depends on it. `Injector.create` is deliberately not used — `injectQuery` creates an `effect()` internally, effects need a scheduler, and an injector without an `ApplicationRef` would leave a query permanently pending. A hanging test is worse than a failing one, so the harness that provides a real `ApplicationRef` is established up front.

Create `packages/angular/vitest.setup.ts`:

```ts
import "zone.js";
import "zone.js/testing";
import { getTestBed } from "@angular/core/testing";
import { BrowserTestingModule, platformBrowserTesting } from "@angular/platform-browser/testing";
import { fetch, Headers, Request, Response, FormData } from "undici";

getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

// jsdom + MSW v2: pin network primitives to the single undici realm that
// `msw/node` patches, so AbortSignal/Request instance checks line up.
Object.assign(globalThis, { fetch, Headers, Request, Response, FormData });
```

Create `packages/angular/tests/harness.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ApplicationRef, InjectionToken, inject } from "@angular/core";
import { TestBed } from "@angular/core/testing";

const PROBE = new InjectionToken<string>("PROBE");

/**
 * The harness itself is under test here, not the product. Every later test in
 * this package leans on TestBed being able to (a) resolve a token and (b) hand
 * out a real ApplicationRef — the second is what makes TanStack's internal
 * `effect()` flush. Without this test, a broken harness would surface as
 * queries that never resolve, which reads like a product bug.
 */
describe("Angular test harness", () => {
  it("resolves a token through runInInjectionContext", () => {
    TestBed.configureTestingModule({
      providers: [{ provide: PROBE, useValue: "ok" }],
    });
    const value = TestBed.runInInjectionContext(() => inject(PROBE));
    expect(value).toBe("ok");
  });

  it("provides an ApplicationRef, which is what lets effects flush", () => {
    TestBed.configureTestingModule({ providers: [] });
    expect(TestBed.inject(ApplicationRef)).toBeDefined();
  });
});
```

- [ ] **Step 5: Install and run the harness test**

```bash
pnpm install
pnpm -F @viu/emporix-sdk-angular exec vitest run tests/harness.test.ts
```

Expected: 2 passed.

**If the `@angular/platform-browser/testing` import fails to resolve**, the module was named `@angular/platform-browser-dynamic/testing` before Angular 20. Substitute in `vitest.setup.ts`:

```ts
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from "@angular/platform-browser-dynamic/testing";
getTestBed().initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
```

and add `"@angular/platform-browser-dynamic": "^22.1.3"` to `devDependencies`. Record which one worked in a comment in `vitest.setup.ts` — the next reader should not have to rediscover it.

- [ ] **Step 6: Write the failing test for `provideEmporix`**

Create `packages/angular/tests/provide.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TestBed } from "@angular/core/testing";
import { QueryClient } from "@tanstack/angular-query-experimental";
import { EmporixNotFoundError } from "@viu/emporix-sdk";
import { provideEmporix, injectEmporix } from "../src/provide";

// Minimal stand-in: provideEmporix only stores the client, so a real
// EmporixClient would add a network surface for nothing.
const fakeClient = { tenant: "acme" } as never;

describe("provideEmporix", () => {
  it("makes the client and a fallback storage injectable", () => {
    TestBed.configureTestingModule({ providers: [provideEmporix({ client: fakeClient })] });
    const { client, storage } = TestBed.runInInjectionContext(() => injectEmporix());
    expect(client).toBe(fakeClient);
    // The fallback is a real memory storage, not null: every downstream
    // injectable reads storage unconditionally.
    expect(storage.getCustomerToken()).toBeNull();
  });

  it("uses a supplied storage instead of the fallback", () => {
    TestBed.configureTestingModule({
      providers: [provideEmporix({ client: fakeClient, storage: makeStorageWithToken("t1") })],
    });
    const { storage } = TestBed.runInInjectionContext(() => injectEmporix());
    expect(storage.getCustomerToken()).toBe("t1");
  });

  it("scopes the emporix query defaults without touching global defaults", () => {
    const qc = new QueryClient();
    TestBed.configureTestingModule({
      providers: [provideEmporix({ client: fakeClient, queryClient: qc })],
    });
    const defaults = qc.getQueryDefaults(["emporix"]);
    expect(defaults?.staleTime).toBe(30_000);
    expect(defaults?.refetchOnWindowFocus).toBe(false);
    // A host application's own queries must be unaffected.
    expect(qc.getDefaultOptions().queries?.staleTime).toBeUndefined();
  });

  it("does not retry a 404 — the resource is gone and the retry is billed", () => {
    const qc = new QueryClient();
    TestBed.configureTestingModule({
      providers: [provideEmporix({ client: fakeClient, queryClient: qc })],
    });
    const retry = qc.getQueryDefaults(["emporix"])?.retry as (c: number, e: unknown) => boolean;
    expect(retry(0, new EmporixNotFoundError("gone", 404))).toBe(false);
    expect(retry(0, new Error("network"))).toBe(true);
    expect(retry(1, new Error("network"))).toBe(false);
  });

  it("lets a consumer's explicit emporix defaults win over ours", () => {
    const qc = new QueryClient();
    qc.setQueryDefaults(["emporix"], { staleTime: 1 });
    TestBed.configureTestingModule({
      providers: [provideEmporix({ client: fakeClient, queryClient: qc })],
    });
    expect(qc.getQueryDefaults(["emporix"])?.staleTime).toBe(1);
  });
});

function makeStorageWithToken(token: string) {
  // Local helper rather than a shared fixture: only this file needs it, and
  // Task 3 replaces createMemoryStorage's import path anyway.
  const s = { token } as { token: string | null };
  return {
    getCustomerToken: () => s.token,
    setCustomerToken: (t: string | null) => { s.token = t; },
    getCartId: () => null,
    setCartId: () => {},
    getAnonymousSession: () => null,
    setAnonymousSession: () => {},
    getSiteCode: () => null,
    setSiteCode: () => {},
    getLanguage: () => null,
    setLanguage: () => {},
    getActiveLegalEntityId: () => null,
    setActiveLegalEntityId: () => {},
    getRefreshToken: () => null,
    setRefreshToken: () => {},
  } as never;
}
```

- [ ] **Step 7: Run it to confirm it fails**

```bash
pnpm -F @viu/emporix-sdk-angular exec vitest run tests/provide.test.ts
```

Expected: FAIL — `Cannot find module '../src/provide'`.

- [ ] **Step 8: Write the tokens**

Create `packages/angular/src/tokens.ts`:

```ts
import { InjectionToken } from "@angular/core";
import type { EmporixClient, EmporixStorage } from "@viu/emporix-sdk";

/**
 * The SDK client. A token rather than a service class because a class would
 * need `@Injectable()`, and a decorator would pull in the Angular compiler —
 * which is exactly what this package is built to avoid.
 */
export const EMPORIX_CLIENT = new InjectionToken<EmporixClient>("EMPORIX_CLIENT");

/** Persisted session state. Always present: `provideEmporix` supplies a memory fallback. */
export const EMPORIX_STORAGE = new InjectionToken<EmporixStorage>("EMPORIX_STORAGE");
```

- [ ] **Step 9: Write `provideEmporix`**

Create `packages/angular/src/provide.ts`:

```ts
import { inject, makeEnvironmentProviders, type EnvironmentProviders } from "@angular/core";
import { provideTanStackQuery, QueryClient } from "@tanstack/angular-query-experimental";
import { EmporixNotFoundError, type EmporixClient, type EmporixStorage } from "@viu/emporix-sdk";
// TEMPORARY: Task 3 moves the browser storage backends into @viu/emporix-sdk and
// this import becomes `from "@viu/emporix-sdk"`. It is a devDependency edge
// today, deliberately not a peer — no published artifact depends on it.
import { createMemoryStorage } from "@viu/emporix-sdk-react";
import { EMPORIX_CLIENT, EMPORIX_STORAGE } from "./tokens";

export interface EmporixConfig {
  client: EmporixClient;
  /** Defaults to an in-memory storage: SSR-safe, no persistence. */
  storage?: EmporixStorage;
  /** Bring your own to share one cache with the host application. */
  queryClient?: QueryClient;
}

/**
 * Balanced query defaults, scoped to the `["emporix"]` key namespace.
 *
 * A 404 is an answer, not a failure worth repeating: the resource is gone and
 * the retry bills the tenant for the same answer. Emporix charges per API call,
 * and a stale cart id — one closed by a checkout on another device — is exactly
 * the case that would pay it on every mount.
 */
const DEFAULT_QUERY_OPTIONS = {
  staleTime: 30_000,
  refetchOnWindowFocus: false,
  retry: (count: number, error: unknown) =>
    !(error instanceof EmporixNotFoundError) && count < 1,
} as const;

/**
 * Fill gaps in the `["emporix"]` defaults without overriding intent. A
 * consumer's explicit choices win, whether set globally or emporix-scoped —
 * both are spread after ours. Host-application queries outside the namespace
 * are untouched.
 *
 * Called once from `provideEmporix`. React needs a ref guard here because its
 * provider re-renders; an `EnvironmentProviders` factory runs once per injector,
 * so there is nothing to guard against.
 */
export function applyEmporixQueryDefaults(qc: QueryClient): void {
  qc.setQueryDefaults(["emporix"], {
    ...DEFAULT_QUERY_OPTIONS,
    ...qc.getDefaultOptions().queries,
    ...qc.getQueryDefaults(["emporix"]),
  });
}

/**
 * Wires the SDK into an Angular application.
 *
 * Composes `provideTanStackQuery` internally, mirroring how React's
 * `EmporixProvider` renders `QueryClientProvider` itself — one call, one
 * ownership model, no second thing for the consumer to remember.
 *
 * @example
 * ```ts
 * bootstrapApplication(AppComponent, {
 *   providers: [provideEmporix({ client: createEmporixClient({ ... }) })],
 * })
 * ```
 */
export function provideEmporix(config: EmporixConfig): EnvironmentProviders {
  const storage = config.storage ?? createMemoryStorage();
  const queryClient = config.queryClient ?? new QueryClient();
  applyEmporixQueryDefaults(queryClient);
  return makeEnvironmentProviders([
    { provide: EMPORIX_CLIENT, useValue: config.client },
    { provide: EMPORIX_STORAGE, useValue: storage },
    provideTanStackQuery(queryClient),
  ]);
}

/** The SDK client and session storage. Must be called in an injection context. */
export function injectEmporix(): { client: EmporixClient; storage: EmporixStorage } {
  return { client: inject(EMPORIX_CLIENT), storage: inject(EMPORIX_STORAGE) };
}
```

- [ ] **Step 10: Write the entry barrels**

Create `packages/angular/src/index.ts`:

```ts
export { provideEmporix, injectEmporix, applyEmporixQueryDefaults } from "./provide";
export type { EmporixConfig } from "./provide";
export { EMPORIX_CLIENT, EMPORIX_STORAGE } from "./tokens";
```

Create `packages/angular/src/storage.ts` and `packages/angular/src/ssr.ts` each with a single line, so the three entries in `tsup.config.ts` and `package.json` resolve from the first build:

```ts
// Filled in by Task 3 (storage) and a later plan (ssr). Present now so the
// package's declared entries all resolve — a declared-but-missing entry is a
// broken published artifact.
export {};
```

- [ ] **Step 11: Run the tests**

```bash
pnpm -F @viu/emporix-sdk-angular exec vitest run
```

Expected: 7 passed (2 harness + 5 provide).

- [ ] **Step 12: Verify lint, types and build**

```bash
pnpm -F @viu/emporix-sdk-angular lint
pnpm -F @viu/emporix-sdk-angular typecheck
pnpm -F @viu/emporix-sdk-angular build
```

All three exit 0, and `packages/angular/dist/` contains `index.js`, `index.d.ts`, `storage.js`, `ssr.js`. No `.cjs` files — the manifest declares ESM only.

- [ ] **Step 13: Commit**

```bash
git add commitlint.config.js packages/angular pnpm-lock.yaml
git commit -m "feat(angular): scaffold the package with provideEmporix and injectEmporix

Adds the `angular` commit scope first, because .husky/commit-msg rejects
unknown scopes and nothing in this series lands without it.

TestBed rather than Injector.create for the test harness: injectQuery creates
an effect() internally and effects need a scheduler, so an injector without an
ApplicationRef would leave queries permanently pending. tests/harness.test.ts
asserts both halves of that up front, so a broken harness cannot later be
mistaken for a product bug.

ESM only. @angular/core publishes no main entry and the TanStack Angular
adapter is ESM-only; Angular applications always bundle, so a CJS half would
exist for no consumer.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Retire the toolchain risk — AOT production build

The spec's premise is that tsup output survives an Angular AOT production build. That rests on TanStack's published artifact, **not on ours**. This task falsifies or confirms it before eight tasks are built on top. If it fails, the toolchain decision inverts and this plan is rewritten.

**Files:**
- Create: `examples/angular-storefront/` (generated by the Angular CLI, then trimmed)
- Create: `packages/angular/scripts/check-dist.mjs`
- Modify: `.github/workflows/pr-check.yml`
- Modify: `pnpm-workspace.yaml` — no change needed, `examples/*` already globs

**Interfaces:**
- Consumes: `provideEmporix` from Task 1.
- Produces: a CI gate. No source interface.

---

- [ ] **Step 1: Write the decorator guard**

Create `packages/angular/scripts/check-dist.mjs`:

```js
// Guards the toolchain premise of this package.
//
// This package is built with tsup instead of ng-packagr because it exports only
// functions — no decorators, no templates — and therefore needs no Angular
// compiler. The premise was established by unpacking
// @tanstack/angular-query-experimental and finding zero compiler output in it.
// This is that same probe, kept as a regression test: the day someone adds an
// @Injectable() or a component, the build fails here rather than shipping an
// artifact that breaks in a consumer's AOT build.
import { readFileSync, readdirSync } from "node:fs";

const MARKERS = ["ɵɵngDeclare", "ɵprov", "ɵfac", "__decorate"];
const dist = new URL("../dist/", import.meta.url);
let failed = false;

for (const name of readdirSync(dist)) {
  if (!name.endsWith(".js")) continue;
  const source = readFileSync(new URL(name, dist), "utf8");
  for (const marker of MARKERS) {
    if (source.includes(marker)) {
      console.error(`FAIL dist/${name}: contains Angular compiler output "${marker}"`);
      console.error("  This package must stay decorator-free — see");
      console.error("  docs/superpowers/specs/2026-08-25-angular-package-design.md");
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log(`dist is free of Angular compiler output (${MARKERS.length} markers checked)`);
```

- [ ] **Step 2: Run the guard against the Task 1 build**

```bash
pnpm -F @viu/emporix-sdk-angular build
pnpm -F @viu/emporix-sdk-angular check:dist
```

Expected: `dist is free of Angular compiler output (4 markers checked)`, exit 0.

- [ ] **Step 3: Prove the guard actually catches something**

A guard that has never failed is a guard nobody has tested. Temporarily append a decorator to `packages/angular/src/index.ts`:

```ts
// TEMPORARY — delete after this step.
import { Injectable } from "@angular/core";
@Injectable()
export class Probe {}
```

Then:

```bash
pnpm -F @viu/emporix-sdk-angular build && pnpm -F @viu/emporix-sdk-angular check:dist
```

Expected: FAIL, naming `__decorate`. **Then delete those five lines** and re-run to confirm it passes again. (ESLint's `Decorator` rule from Task 1 will also flag it — that is two independent guards on the same constraint, which is intended.)

- [ ] **Step 4: Generate the example application**

Use the CLI rather than hand-writing `angular.json`: the generated scaffold is correct for the installed version, and a hand-written one drifts from the schema.

```bash
cd examples
pnpm dlx @angular/cli@22.1.5 new angular-storefront --skip-git --skip-install --style=css --ssr=false --routing=false
cd ..
```

- [ ] **Step 5: Wire the example into the workspace**

Edit `examples/angular-storefront/package.json`: set `"name": "@viu/emporix-examples-angular"` (the `@viu/emporix-examples-*` glob in `.changeset/config.json` `ignore` is what keeps it unpublished), add `"private": true`, and add to `dependencies`:

```json
"@viu/emporix-sdk": "workspace:*",
"@viu/emporix-sdk-angular": "workspace:*",
"@tanstack/angular-query-experimental": "^5.102.3"
```

Then:

```bash
pnpm install
```

- [ ] **Step 6: Make the example actually import the built package**

A production build that never touches our code proves nothing. Replace `examples/angular-storefront/src/app/app.config.ts` (or `app.config.ts` at whatever path the CLI generated — check the `bootstrapApplication` call in `src/main.ts`):

```ts
import type { ApplicationConfig } from "@angular/core";
import { provideEmporix } from "@viu/emporix-sdk-angular";
import { createEmporixClient } from "@viu/emporix-sdk";

/**
 * The point of this file is the import above. This example exists to prove that
 * a tsup-built artifact survives `ng build --configuration production` with AOT
 * and `ngJitMode: false` — which is the premise the whole package rests on.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideEmporix({
      client: createEmporixClient({
        tenant: "viu",
        clientId: "storefront-public",
      }),
    }),
  ],
};
```

Check the exact `createEmporixClient` signature against `examples/vite-spa/src/main.tsx` and copy its shape — the SDK's client factory takes more than these two fields in practice, and the example must compile.

- [ ] **Step 7: Run the production build — the load-bearing step**

```bash
pnpm -F @viu/emporix-sdk-angular build
pnpm -F @viu/emporix-examples-angular exec ng build --configuration production
```

Expected: build succeeds, `examples/angular-storefront/dist/` written.

**If it fails**, stop and read the error before changing anything:
- `NG` errors about JIT, `ɵɵ` symbols, or "decorators are not supported" → the tsup premise is wrong. Stop the plan and report; the spec's toolchain decision has to be revisited, and phases 3–9 change.
- Module-resolution errors (`Cannot find module`, `exports` mismatch) → the `exports` map in `packages/angular/package.json` needs the condition Angular's bundler actually asks for. Fixable here; report what was needed.
- Typescript errors in the example only → the example is wrong, not the package. Fix the example.

Record the outcome in the commit message either way. This step's *result* is the deliverable, not just its success.

- [ ] **Step 8: Add both gates to CI**

In `.github/workflows/pr-check.yml`, after the existing React `check:dist` step, add:

```yaml
      # This package is built with tsup rather than ng-packagr because it is
      # decorator-free. Assert that stayed true.
      - name: Assert the angular dist has no Angular compiler output
        run: pnpm -F @viu/emporix-sdk-angular check:dist

      # The premise above only holds if a real AOT production build accepts the
      # artifact. This is the test that would catch it breaking.
      - name: Build the angular example with AOT
        run: pnpm -F @viu/emporix-examples-angular exec ng build --configuration production
```

Also add a comment at the `matrix.node` list explaining the expected warning:

```yaml
      matrix:
        # Angular 22 declares engines.node ^22.22.3 || ^24.15.0 || >=26.0.0, so
        # Node 20 emits EBADENGINE on install. .npmrc sets no engine-strict, so
        # it warns rather than fails, and tsc/vitest do not care. The row stays
        # because the other four packages support Node 20.
        node: [20, 22, 24]
```

- [ ] **Step 9: Verify the whole workspace still passes**

```bash
pnpm -r --filter "./packages/*" build
pnpm typecheck
pnpm test
pnpm lint
```

All four exit 0. Note `pnpm test` (not `pnpm -r test`) — the root script filters to `./packages/*`; `pnpm -r test` would also run the `e2e` project against the live tenant.

- [ ] **Step 10: Commit**

```bash
git add packages/angular examples/angular-storefront .github/workflows/pr-check.yml pnpm-lock.yaml
git commit -m "feat(angular): prove the tsup artifact survives an AOT production build

The spec's premise — that a decorator-free Angular library needs no
ng-packagr — rested on TanStack's published artifact rather than ours. This
retires that risk before anything is built on top of it.

check-dist.mjs is the same probe that established the premise (grep dist for
ɵɵngDeclare/ɵprov/ɵfac/__decorate), kept as a regression test, and it was
verified to actually fail by temporarily adding an @Injectable(). ESLint's
Decorator rule guards the same constraint at the source level.

examples/angular-storefront imports provideEmporix from the built package, so
`ng build --configuration production` exercises the artifact instead of just
compiling an empty app. Both gates run in pr-check.yml.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Move the framework-agnostic code into the SDK

`@viu/emporix-sdk-angular` needs `emporixKey`, `getCustomerSessionStore` and the browser storage backends. All three live in `packages/react` today and none of them is a React concern. The repo has made this move twice already, with the reasoning written down in `packages/react/src/storage/keys.ts`; this is the third instance of the same pattern.

**Files:**
- Create: `packages/sdk/src/core/browser-storage.ts`, `src/core/query-keys.ts`, `src/core/customer-session-store.ts`
- Modify: `packages/sdk/src/index.ts`
- Modify (to re-exports): `packages/react/src/storage/index.ts`, `memory.ts`, `local-storage.ts`, `session-storage.ts`, `cookie.ts`, `web-storage.ts`, `cookie-core.ts`, `hooks/internal/query-keys.ts`, `hooks/internal/customer-session-store.ts`
- Modify: `packages/angular/src/provide.ts` (drop the temporary react import), `src/storage.ts`
- Modify: `packages/angular/package.json` (drop the `@viu/emporix-sdk-react` devDependency)
- Test: `packages/react/tests/agnostic-single-source.test.ts`, `packages/angular/tests/storage-entry.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces, all from `@viu/emporix-sdk`:
  - `emporixKey<TArgs extends readonly unknown[]>(resource: string, args: TArgs, context: { tenant: string; authKind: string; siteCode?: string | null; language?: string | null }): readonly ["emporix", string, ...TArgs, Record<string, unknown>]`
  - `siteMeta(site: SiteFields, siteCode: string | null, language: string | null): { siteCode?: string | null; language?: string | null }`
  - `type SiteFields = "full" | "language" | "none"`
  - `getCustomerSessionStore(storage: EmporixStorage): CustomerSessionStore`
  - `interface CustomerSessionState { token: string | null; refreshToken: string | null; saasToken: string | null }`
  - `interface CustomerSessionStore { getSnapshot(): CustomerSessionState; setState(next): void; subscribe(l: () => void): () => void }`
  - `createListenerSet<T>(): { add(l: (v: T) => void): () => void; notify(v: T): void }`
  - `createMemoryStorage(opts?: { initial?: string }): EmporixStorage`
  - `createLocalStorage`, `createLocalStorageStorage`, `createSessionStorage`, `createCookieStorage`

---

- [ ] **Step 1: Write the single-source guard test first**

This is the test that makes the move safe. Modelled on the existing `packages/react/tests/session-keys-single-source.test.ts`, which guards the same class of mistake for `STORAGE_KEYS`.

Create `packages/react/tests/agnostic-single-source.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  emporixKey as keyFromSdk,
  siteMeta as metaFromSdk,
  getCustomerSessionStore as storeFromSdk,
  createMemoryStorage as memoryFromSdk,
} from "@viu/emporix-sdk";
import { emporixKey, siteMeta } from "../src/hooks/internal/query-keys";
import { getCustomerSessionStore } from "../src/hooks/internal/customer-session-store";
import { createMemoryStorage } from "../src/storage/index";

/**
 * Three more pieces moved down to `@viu/emporix-sdk` so `@viu/emporix-sdk-angular`
 * could use them without depending on the React bindings — the same move
 * `STORAGE_KEYS` and `EmporixStorage` already made.
 *
 * Identity, not deep equality. `toEqual` would pass on a duplicated
 * implementation, which is exactly the failure this guards: two query-key
 * builders that agree today and drift in six months, splitting every cache
 * entry in half.
 */
describe("the agnostic layer has exactly one definition", () => {
  it("re-exports the same function objects the SDK defines", () => {
    expect(emporixKey).toBe(keyFromSdk);
    expect(siteMeta).toBe(metaFromSdk);
    expect(getCustomerSessionStore).toBe(storeFromSdk);
    expect(createMemoryStorage).toBe(memoryFromSdk);
  });

  it("still produces the key shape the React hooks assert", () => {
    // Pinned because a shape change invalidates every cached entry in every
    // deployed browser at once.
    expect(
      emporixKey("product", ["p1"], { tenant: "acme", authKind: "anonymous" }),
    ).toEqual(["emporix", "product", "p1", { tenant: "acme", authKind: "anonymous" }]);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
pnpm -F @viu/emporix-sdk-react exec vitest run tests/agnostic-single-source.test.ts
```

Expected: FAIL — the SDK exports none of these names yet.

- [ ] **Step 3: Move the query-key builder**

Create `packages/sdk/src/core/query-keys.ts` by moving the entire contents of `packages/react/src/hooks/internal/query-keys.ts` verbatim, then replacing its file-level doc comment with one that states why it lives in the SDK:

```ts
/**
 * The cache-key shape every framework binding shares.
 *
 * Shape: `["emporix", resource, ...args, { tenant, authKind, siteCode?, language? }]`
 *
 * It lives in the core SDK for the same reason {@link STORAGE_KEYS} does: it is
 * not a React concern. `@viu/emporix-sdk-react` and `@viu/emporix-sdk-angular`
 * must produce byte-identical keys or the two bindings, the docs and the
 * devtools all describe different caches. One definition is the only way that
 * holds — a copy per binding would agree on the day it was written and nowhere
 * after.
 */
```

The two exported functions and `SiteFields` are unchanged.

- [ ] **Step 4: Replace the React file with a re-export**

Overwrite `packages/react/src/hooks/internal/query-keys.ts`:

```ts
/**
 * Moved to `@viu/emporix-sdk` (`core/query-keys.ts`): the key shape has to be
 * identical across framework bindings, so it cannot live in one of them. This
 * re-export keeps every existing import in this package working, and there is
 * deliberately only ONE definition — see `tests/agnostic-single-source.test.ts`.
 */
export { emporixKey, siteMeta } from "@viu/emporix-sdk";
export type { SiteFields } from "@viu/emporix-sdk";
```

- [ ] **Step 5: Move the customer session store**

Create `packages/sdk/src/core/customer-session-store.ts` with the full contents of `packages/react/src/hooks/internal/customer-session-store.ts`, changing only the import (`import type { EmporixStorage } from "./session-storage";`) and prepending to the file doc:

```ts
/**
 * In-memory customer-session store, keyed by storage instance.
 *
 * Moved out of the React bindings: it is a subscribe/snapshot store over
 * `EmporixStorage` with no framework API in it. React consumes it through
 * `useSyncExternalStore`, Angular through a `signal` — the store itself does
 * not know or care.
 */
```

Overwrite `packages/react/src/hooks/internal/customer-session-store.ts`:

```ts
/**
 * Moved to `@viu/emporix-sdk` (`core/customer-session-store.ts`) — a
 * subscribe/snapshot store over `EmporixStorage` is not a React concern, and
 * `@viu/emporix-sdk-angular` needs the same one. Re-exported so existing
 * imports keep working; there is exactly one definition.
 */
export { getCustomerSessionStore } from "@viu/emporix-sdk";
export type { CustomerSessionState, CustomerSessionStore } from "@viu/emporix-sdk";
```

- [ ] **Step 6: Move the browser storage backends**

Create `packages/sdk/src/core/browser-storage.ts` containing, in this order:
1. `createListenerSet` — lifted from `packages/react/src/storage/index.ts` lines 25-45, verbatim.
2. The full contents of `packages/react/src/storage/web-storage.ts`, `local-storage.ts`, `session-storage.ts`, `cookie-core.ts` and `cookie.ts`, with their cross-file imports collapsed to local references and `EmporixStorage` / `EmporixStorageKey` / `PersistedAnonymousSession` imported from `./session-storage`.

File doc:

```ts
/**
 * The browser session-storage backends: memory, localStorage, sessionStorage,
 * document.cookie.
 *
 * The contract and the framework-free backends live in `./session-storage`;
 * these are the ones that need browser globals. They were in
 * `@viu/emporix-sdk-react` until `@viu/emporix-sdk-angular` needed them too —
 * `localStorage` is not a React API, and duplicating a storage backend per
 * binding means two of them writing subtly different values under the same key.
 *
 * Every export is a named factory and the package sets `sideEffects: false`, so
 * a Node consumer that imports none of them bundles none of them. That is
 * asserted by `scripts/check-treeshake.mjs`.
 */
```

Then replace each of the six React files with a re-export. `packages/react/src/storage/memory.ts`:

```ts
/**
 * Moved to `@viu/emporix-sdk` (`core/browser-storage.ts`) — see that file for
 * why. Re-exported: `createMemoryStorage` has always been part of this
 * package's public surface.
 */
export { createMemoryStorage } from "@viu/emporix-sdk";
```

Apply the same treatment to `local-storage.ts` (`createLocalStorage`, `createLocalStorageStorage`), `session-storage.ts` (`createSessionStorage`), `cookie.ts` (`createCookieStorage`), `web-storage.ts` and `cookie-core.ts` (re-export whatever internal names other files in the package still import — check with `grep -rn "from \"./web-storage\"\|from \"./cookie-core\"" packages/react/src`).

In `packages/react/src/storage/index.ts`, replace the local `createListenerSet` definition with `export { createListenerSet } from "@viu/emporix-sdk";` and leave the rest of the barrel unchanged.

- [ ] **Step 7: Export the three modules from the SDK**

In `packages/sdk/src/index.ts`, add next to the existing `session-storage` / `session-keys` exports:

```ts
export { emporixKey, siteMeta } from "./core/query-keys";
export type { SiteFields } from "./core/query-keys";
export { getCustomerSessionStore } from "./core/customer-session-store";
export type { CustomerSessionState, CustomerSessionStore } from "./core/customer-session-store";
export {
  createListenerSet,
  createMemoryStorage,
  createLocalStorage,
  createLocalStorageStorage,
  createSessionStorage,
  createCookieStorage,
} from "./core/browser-storage";
```

- [ ] **Step 8: Run the guard and the full React suite**

```bash
pnpm -F @viu/emporix-sdk-react exec vitest run tests/agnostic-single-source.test.ts
pnpm -F @viu/emporix-sdk test
pnpm -F @viu/emporix-sdk-react test
```

Expected: the guard passes, and **the React suite passes unchanged** — every file it touched became a re-export of the same object, so no behaviour moved. If any React test fails, the move was not behaviour-preserving; fix the move, do not adjust the test.

- [ ] **Step 9: Verify tree-shaking did not regress**

```bash
pnpm -F @viu/emporix-sdk build
pnpm -F @viu/emporix-sdk check:treeshake
```

Expected: exit 0. This is the step that matters for `examples/node-server` — DOM code now sits in the SDK's main entry, and a Node consumer must not bundle it.

- [ ] **Step 10: Point the Angular package at the SDK**

In `packages/angular/src/provide.ts`, delete the `TEMPORARY` comment and its import, and add `createMemoryStorage` to the existing `@viu/emporix-sdk` import:

```ts
import {
  createMemoryStorage,
  EmporixNotFoundError,
  type EmporixClient,
  type EmporixStorage,
} from "@viu/emporix-sdk";
```

Remove `"@viu/emporix-sdk-react": "workspace:*"` from `packages/angular/package.json` `devDependencies` — the Angular package must not depend on the React one in any form, and leaving it invites the next import.

Fill in `packages/angular/src/storage.ts`:

```ts
/**
 * Storage backends, re-exported from `@viu/emporix-sdk` so an Angular consumer
 * has one import site for the whole binding. The definitions live in the SDK
 * because they are shared with the React bindings.
 */
export {
  createMemoryStorage,
  createLocalStorage,
  createLocalStorageStorage,
  createSessionStorage,
  createCookieStorage,
  createCookieBackedStorage,
  createServerStorage,
  parseAnonymousSession,
  STORAGE_KEYS,
} from "@viu/emporix-sdk";
export type {
  EmporixStorage,
  EmporixStorageKey,
  PersistedAnonymousSession,
  TokenStorage,
} from "@viu/emporix-sdk";
```

- [ ] **Step 11: Assert the Angular package has no React dependency**

Create `packages/angular/tests/storage-entry.test.ts`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createMemoryStorage, STORAGE_KEYS } from "../src/storage";

describe("the storage entry", () => {
  it("exposes a working memory backend", () => {
    const s = createMemoryStorage({ initial: "t1" });
    expect(s.getCustomerToken()).toBe("t1");
    s.setCustomerToken(null);
    expect(s.getCustomerToken()).toBeNull();
  });

  it("carries the same eight session keys as every other host", () => {
    expect(Object.keys(STORAGE_KEYS)).toHaveLength(8);
    expect(STORAGE_KEYS.cartId).toBe("emporix.cartId");
  });
});

/**
 * The whole point of Task 3 was that this package needs the agnostic layer, not
 * React. A stray `@viu/emporix-sdk-react` import would still compile — it is a
 * workspace package — and would silently make React a transitive requirement of
 * an Angular application.
 */
describe("no dependency on the React bindings", () => {
  it("has no source file importing @viu/emporix-sdk-react", () => {
    const dir = new URL("../src/", import.meta.url);
    const offenders = readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".ts"))
      .filter((f) => readFileSync(new URL(f, dir), "utf8").includes("@viu/emporix-sdk-react"));
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 12: Run everything**

```bash
pnpm install
pnpm -F @viu/emporix-sdk-angular test
pnpm -r --filter "./packages/*" build
pnpm typecheck
pnpm test
pnpm lint
```

All exit 0.

- [ ] **Step 13: Write the changeset**

Create `.changeset/agnostic-layer-to-sdk.md`:

```markdown
---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": patch
---

feat(sdk): move the query-key builder, customer-session store and browser storage backends into the core SDK

`emporixKey`, `siteMeta`, `getCustomerSessionStore`, `createListenerSet` and the
four browser storage backends (`createMemoryStorage`, `createLocalStorage`,
`createSessionStorage`, `createCookieStorage`) are now defined in
`@viu/emporix-sdk` and re-exported from `@viu/emporix-sdk-react`.

**No breaking change and no behaviour change.** Every existing import keeps
working, and each moved symbol is the same object through both paths — asserted
by identity, not deep equality, in `tests/agnostic-single-source.test.ts`, because
a duplicated implementation would pass a `toEqual` check and then drift.

This is the third instance of a move the repo has already made twice, for the
same reason: `STORAGE_KEYS` and `EmporixStorage` went down so
`@viu/emporix-sdk-next` could stop depending on the React bindings. These three
go down so an Angular binding can do the same. A cache-key builder duplicated
per framework agrees on the day it is written and splits every cache entry in
half thereafter.
```

- [ ] **Step 14: Commit**

```bash
git add packages/sdk packages/react packages/angular .changeset pnpm-lock.yaml
git commit -m "refactor(sdk): move the agnostic layer out of the react bindings

emporixKey/siteMeta, getCustomerSessionStore and the four browser storage
backends move into @viu/emporix-sdk; @viu/emporix-sdk-react re-exports all of
them. Third instance of the move STORAGE_KEYS and EmporixStorage already made,
for the same stated reason.

The guard asserts object identity rather than deep equality: a duplicated
implementation passes toEqual and then drifts, which for a cache-key builder
means splitting every cache entry in half.

check:treeshake verifies a Node consumer still bundles none of the new DOM code.
The angular package's temporary devDependency on the react package is gone, and
a test asserts no source file reintroduces it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: `emporixQueryOptions` — the pure core

The auth resolution, cache key and `enabled` gate of every read, lifted out of the injectable into a function with no Angular import. This is the highest-value task in the plan: it is the logic most likely to be wrong, and here it is testable without a DI container, a component or a scheduler.

`useEmporixQuery` cannot be split this way — the Rules of Hooks force the `useQuery` call into the same body as the `useCustomerToken()` and `useReadSite()` reads. The reactive values become parameters instead.

**Files:**
- Create: `packages/angular/src/query-options.ts`
- Test: `packages/angular/tests/query-options.test.ts`, `packages/angular/tests/key-parity.test.ts`

**Interfaces:**
- Consumes: `emporixKey`, `siteMeta`, `SiteFields`, `auth`, `AuthContext` from `@viu/emporix-sdk` (Task 3).
- Produces:
  - `interface EmporixQueryInput<T, TArgs extends readonly unknown[]>` with fields `resource: string`, `args: TArgs`, `site: SiteFields`, `queryFn: (ctx: AuthContext) => Promise<T>`, `mode: "read-auth" | "customer"`, `authOverride?: AuthContext`, `staleTime?: number`, `enabled?: boolean`
  - `interface EmporixQueryContext` with fields `tenant: string`, `token: string | null`, `siteCode: string | null`, `language: string | null`
  - `emporixQueryOptions<T, TArgs>(input: EmporixQueryInput<T, TArgs>, ctx: EmporixQueryContext): { queryKey; queryFn; enabled; staleTime? }`

---

- [ ] **Step 1: Write the failing tests**

Create `packages/angular/tests/query-options.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { auth } from "@viu/emporix-sdk";
import { emporixQueryOptions } from "../src/query-options";

const base = {
  resource: "product",
  args: ["p1"] as const,
  site: "full" as const,
  queryFn: vi.fn(async () => "value"),
};
const ctx = { tenant: "acme", token: null, siteCode: "main", language: "de" };

describe("emporixQueryOptions — read-auth mode", () => {
  it("keys as anonymous and enables when no token is stored", () => {
    const o = emporixQueryOptions({ ...base, mode: "read-auth" }, ctx);
    expect(o.queryKey).toEqual([
      "emporix",
      "product",
      "p1",
      { tenant: "acme", authKind: "anonymous", siteCode: "main", language: "de" },
    ]);
    expect(o.enabled).toBe(true);
  });

  it("keys as customer once a token is stored", () => {
    const o = emporixQueryOptions({ ...base, mode: "read-auth" }, { ...ctx, token: "t1" });
    expect(o.queryKey[3]).toMatchObject({ authKind: "customer" });
  });

  it("passes the resolved auth context to queryFn", async () => {
    const queryFn = vi.fn(async () => "v");
    const o = emporixQueryOptions({ ...base, queryFn, mode: "read-auth" }, { ...ctx, token: "t1" });
    await o.queryFn();
    expect(queryFn).toHaveBeenCalledWith(auth.customer("t1"));
  });

  it("honours an explicit auth override", () => {
    const o = emporixQueryOptions(
      { ...base, mode: "read-auth", authOverride: auth.anonymous() },
      { ...ctx, token: "t1" },
    );
    expect(o.queryKey[3]).toMatchObject({ authKind: "anonymous" });
  });
});

describe("emporixQueryOptions — customer mode", () => {
  it("stays disabled without a token, so nothing is ever fetched unauthenticated", () => {
    const o = emporixQueryOptions({ ...base, mode: "customer" }, ctx);
    expect(o.enabled).toBe(false);
    // Still keyed, and keyed as anonymous — a guest's cache entry must not
    // collide with a customer's.
    expect(o.queryKey[3]).toMatchObject({ authKind: "anonymous" });
  });

  it("enables and keys as customer with a token", () => {
    const o = emporixQueryOptions({ ...base, mode: "customer" }, { ...ctx, token: "t1" });
    expect(o.enabled).toBe(true);
    expect(o.queryKey[3]).toMatchObject({ authKind: "customer" });
  });

  it("ignores an authOverride — customer mode is token-gated by definition", () => {
    const o = emporixQueryOptions(
      { ...base, mode: "customer", authOverride: auth.anonymous() },
      { ...ctx, token: "t1" },
    );
    expect(o.queryKey[3]).toMatchObject({ authKind: "customer" });
  });
});

describe("emporixQueryOptions — gates and site fields", () => {
  it("ANDs a caller's enabled with the internal gate", () => {
    expect(
      emporixQueryOptions({ ...base, mode: "read-auth", enabled: false }, ctx).enabled,
    ).toBe(false);
    expect(
      emporixQueryOptions({ ...base, mode: "customer", enabled: true }, ctx).enabled,
    ).toBe(false);
  });

  it("drops site fields entirely for site: none", () => {
    const o = emporixQueryOptions({ ...base, site: "none", mode: "read-auth" }, ctx);
    expect(o.queryKey[3]).toEqual({ tenant: "acme", authKind: "anonymous" });
  });

  it("carries only language for site: language", () => {
    const o = emporixQueryOptions({ ...base, site: "language", mode: "read-auth" }, ctx);
    expect(o.queryKey[3]).toEqual({ tenant: "acme", authKind: "anonymous", language: "de" });
  });

  it("preserves a null site rather than omitting it — unbound is its own identity", () => {
    const o = emporixQueryOptions(
      { ...base, mode: "read-auth" },
      { ...ctx, siteCode: null, language: null },
    );
    expect(o.queryKey[3]).toEqual({
      tenant: "acme",
      authKind: "anonymous",
      siteCode: null,
      language: null,
    });
  });

  it("omits staleTime when not given, rather than setting it to undefined", () => {
    // exactOptionalPropertyTypes is on repo-wide; an explicit `undefined` would
    // override the ["emporix"] default of 30s with nothing.
    expect("staleTime" in emporixQueryOptions({ ...base, mode: "read-auth" }, ctx)).toBe(false);
    expect(
      emporixQueryOptions({ ...base, mode: "read-auth", staleTime: 5 }, ctx).staleTime,
    ).toBe(5);
  });
});
```

Create `packages/angular/tests/key-parity.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { emporixKey, siteMeta } from "@viu/emporix-sdk";
import { emporixQueryOptions } from "../src/query-options";

/**
 * The Angular and React bindings must produce byte-identical cache keys. Task 3
 * gave them one shared builder, which makes that structural rather than hoped
 * for — but only if this package actually routes through it. This test is what
 * catches a hand-rolled key sneaking in later.
 */
describe("cache-key parity with the shared builder", () => {
  const cases = [
    { site: "full" as const, siteCode: "main", language: "de", token: null },
    { site: "full" as const, siteCode: null, language: null, token: "t1" },
    { site: "language" as const, siteCode: "main", language: "en", token: "t1" },
    { site: "none" as const, siteCode: "main", language: "de", token: null },
  ];

  for (const c of cases) {
    it(`matches for site: ${c.site}, token: ${c.token ?? "none"}`, () => {
      const options = emporixQueryOptions(
        {
          resource: "product",
          args: ["p1"] as const,
          site: c.site,
          queryFn: async () => "v",
          mode: "read-auth",
        },
        { tenant: "acme", token: c.token, siteCode: c.siteCode, language: c.language },
      );
      const expected = emporixKey("product", ["p1"], {
        tenant: "acme",
        authKind: c.token ? "customer" : "anonymous",
        ...siteMeta(c.site, c.siteCode, c.language),
      });
      expect(options.queryKey).toEqual(expected);
    });
  }
});
```

- [ ] **Step 2: Run them to confirm they fail**

```bash
pnpm -F @viu/emporix-sdk-angular exec vitest run tests/query-options.test.ts tests/key-parity.test.ts
```

Expected: FAIL — `Cannot find module '../src/query-options'`.

- [ ] **Step 3: Write the implementation**

Create `packages/angular/src/query-options.ts`:

```ts
import {
  auth,
  emporixKey,
  siteMeta,
  type AuthContext,
  type SiteFields,
} from "@viu/emporix-sdk";

/** What the caller of a read injectable describes: the resource, not the session. */
export interface EmporixQueryInput<T, TArgs extends readonly unknown[]> {
  resource: string;
  args: TArgs;
  /** Which site discriminators belong in the cache key. */
  site: SiteFields;
  /** Receives the resolved auth context. */
  queryFn: (ctx: AuthContext) => Promise<T>;
  /**
   * `read-auth` — customer if a token is stored, anonymous otherwise.
   * `customer` — token-gated: keyed either way, enabled only with a token.
   */
  mode: "read-auth" | "customer";
  /** Per-call override. Ignored in `customer` mode, which is gated by definition. */
  authOverride?: AuthContext;
  staleTime?: number;
  /** ANDed with the internal gate, never replacing it. */
  enabled?: boolean;
}

/** The session state a read depends on, read from signals by the caller. */
export interface EmporixQueryContext {
  tenant: string;
  token: string | null;
  siteCode: string | null;
  language: string | null;
}

/**
 * Build the TanStack query options for an Emporix read.
 *
 * Deliberately free of any `@angular/core` import. Everything reactive arrives
 * as a plain value in `ctx`, so the auth resolution, the cache key and the
 * `enabled` gate — the parts most likely to be wrong — are testable with a
 * function call and no DI container, component or scheduler.
 *
 * The React equivalent (`useEmporixQuery`) cannot be split this way: the Rules
 * of Hooks force its `useQuery` call into the same body as its
 * `useCustomerToken()` and `useReadSite()` reads.
 *
 * Callers MUST read their signals inside `injectQuery`'s options callback, not
 * before it — see `injectEmporixQuery`.
 */
export function emporixQueryOptions<T, TArgs extends readonly unknown[]>(
  input: EmporixQueryInput<T, TArgs>,
  ctx: EmporixQueryContext,
): {
  queryKey: readonly unknown[];
  queryFn: () => Promise<T>;
  enabled: boolean;
  staleTime?: number;
} {
  const override = input.mode === "read-auth" ? input.authOverride : undefined;
  const readCtx: AuthContext =
    override ?? (ctx.token !== null ? auth.customer(ctx.token) : auth.anonymous());

  // In customer mode the key still distinguishes guest from customer, so a
  // guest's (never-fetched) entry cannot be served to a customer later.
  const authKind =
    input.mode === "customer" ? (ctx.token !== null ? "customer" : "anonymous") : readCtx.kind;

  // Customer mode only reaches queryFn when enabled, i.e. when the token is
  // non-null; the fallback keeps the type honest without widening the signature.
  const resolvedCtx: AuthContext =
    input.mode === "customer" ? auth.customer(ctx.token ?? "") : readCtx;

  const enabled =
    (input.enabled ?? true) && (input.mode === "customer" ? ctx.token !== null : true);

  return {
    queryKey: emporixKey(input.resource, input.args, {
      tenant: ctx.tenant,
      authKind,
      ...siteMeta(input.site, ctx.siteCode, ctx.language),
    }),
    queryFn: () => input.queryFn(resolvedCtx),
    enabled,
    // Omitted rather than set to undefined: exactOptionalPropertyTypes is on,
    // and an explicit undefined would override the ["emporix"] 30s default.
    ...(input.staleTime !== undefined ? { staleTime: input.staleTime } : {}),
  };
}
```

- [ ] **Step 4: Run the tests**

```bash
pnpm -F @viu/emporix-sdk-angular exec vitest run tests/query-options.test.ts tests/key-parity.test.ts
```

Expected: 16 passed (12 + 4).

- [ ] **Step 5: Export and verify**

Add to `packages/angular/src/index.ts`:

```ts
export { emporixQueryOptions } from "./query-options";
export type { EmporixQueryInput, EmporixQueryContext } from "./query-options";
```

```bash
pnpm -F @viu/emporix-sdk-angular test
pnpm -F @viu/emporix-sdk-angular lint
pnpm -F @viu/emporix-sdk-angular typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/angular
git commit -m "feat(angular): add emporixQueryOptions, the pure query core

Lifts auth resolution, cache key and the enabled gate out of the injectable
into a function with no @angular/core import, so the logic most likely to be
wrong is testable with a plain function call — no DI container, component or
scheduler. useEmporixQuery cannot be split this way; the Rules of Hooks force
its useQuery call into the same body as its reactive reads.

key-parity.test.ts asserts the output against the shared emporixKey/siteMeta
builder for four site/token combinations, so a hand-rolled key cannot sneak in
later and split the cache between the two bindings.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: `storageSignal` — reactive session state

The load-bearing primitive. `injectQuery` re-runs its options callback in a reactive context, so a signal read inside it re-derives the key and the `enabled` gate on login and logout. Without this, those gates freeze and the bug is invisible until a customer logs out and still sees their orders.

React's equivalent (`useSyncExternalStore` over the storage feed) exists for exactly this reason — its file comment records that raw `storage.getCustomerToken()` reads in hook bodies "never re-rendered on login/logout — `enabled` gates stayed stale until an unrelated re-render".

**Files:**
- Create: `packages/angular/src/storage-signal.ts`
- Test: `packages/angular/tests/storage-signal.test.ts`

**Interfaces:**
- Consumes: `getCustomerSessionStore`, `EmporixStorage`, `EmporixStorageKey` from `@viu/emporix-sdk` (Task 3); `DestroyRef`, `Injector` from `@angular/core`.
- Produces:
  - `storageSignal<T>(storage: EmporixStorage, key: EmporixStorageKey, read: (s: EmporixStorage) => T, opts?: { injector?: Injector }): Signal<T>`
  - `customerTokenSignal(storage: EmporixStorage, opts?: { injector?: Injector }): Signal<string | null>`
  - `cartIdSignal(storage: EmporixStorage, opts?: { injector?: Injector }): Signal<string | null>`

---

- [ ] **Step 1: Write the failing test**

Create `packages/angular/tests/storage-signal.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Injector } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { createMemoryStorage } from "@viu/emporix-sdk";
import { cartIdSignal, customerTokenSignal, storageSignal } from "../src/storage-signal";

describe("customerTokenSignal", () => {
  it("starts at the stored value", () => {
    const storage = createMemoryStorage({ initial: "t1" });
    const token = TestBed.runInInjectionContext(() => customerTokenSignal(storage));
    expect(token()).toBe("t1");
  });

  it("tracks a login written after the signal was created", () => {
    // This is the bug class the React implementation was written to fix: a
    // one-shot read leaves every `enabled` gate frozen at page-load state, so a
    // customer who logs in keeps getting anonymous data until something
    // unrelated invalidates.
    const storage = createMemoryStorage();
    const token = TestBed.runInInjectionContext(() => customerTokenSignal(storage));
    expect(token()).toBeNull();
    storage.setCustomerToken("t2");
    expect(token()).toBe("t2");
  });

  it("tracks a logout", () => {
    const storage = createMemoryStorage({ initial: "t1" });
    const token = TestBed.runInInjectionContext(() => customerTokenSignal(storage));
    storage.setCustomerToken(null);
    expect(token()).toBeNull();
  });
});

describe("cartIdSignal", () => {
  it("tracks cart-id writes and ignores unrelated keys", () => {
    const storage = createMemoryStorage();
    const cartId = TestBed.runInInjectionContext(() => cartIdSignal(storage));
    expect(cartId()).toBeNull();
    storage.setCartId("c1");
    expect(cartId()).toBe("c1");

    // A siteCode write must not disturb the cart signal — every keyed signal
    // shares one subscribeAll feed, so the filter is load-bearing.
    storage.setSiteCode("main");
    expect(cartId()).toBe("c1");
  });
});

describe("storageSignal teardown", () => {
  it("stops updating once its injector is destroyed", () => {
    const storage = createMemoryStorage();
    const injector = Injector.create({ providers: [] });
    const language = storageSignal(storage, "language", (s) => s.getLanguage(), { injector });
    storage.setLanguage("de");
    expect(language()).toBe("de");

    // Injector.create returns a DestroyRef-capable injector; destroying it must
    // detach the storage listener, or a long-lived storage accumulates one
    // listener per destroyed component and leaks for the page's lifetime.
    (injector as unknown as { destroy: () => void }).destroy();
    storage.setLanguage("fr");
    expect(language()).toBe("de");
  });

  it("accepts an explicit injector outside an injection context", () => {
    const storage = createMemoryStorage({ initial: "t1" });
    const injector = Injector.create({ providers: [] });
    // No TestBed.runInInjectionContext wrapper here: this is the escape hatch
    // TanStack's own injectQuery offers, mirrored rather than reinvented.
    expect(customerTokenSignal(storage, { injector })()).toBe("t1");
  });

  it("throws a framework error when called with neither", () => {
    const storage = createMemoryStorage();
    expect(() => customerTokenSignal(storage)).toThrow();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
pnpm -F @viu/emporix-sdk-angular exec vitest run tests/storage-signal.test.ts
```

Expected: FAIL — `Cannot find module '../src/storage-signal'`.

- [ ] **Step 3: Write the implementation**

Create `packages/angular/src/storage-signal.ts`:

```ts
import {
  assertInInjectionContext,
  DestroyRef,
  inject,
  signal,
  type Injector,
  type Signal,
} from "@angular/core";
import {
  getCustomerSessionStore,
  type EmporixStorage,
  type EmporixStorageKey,
} from "@viu/emporix-sdk";

/** Resolve a DestroyRef from an explicit injector or the ambient context. */
function destroyRefFrom(injector: Injector | undefined, debugFn: () => void): DestroyRef {
  if (injector !== undefined) return injector.get(DestroyRef);
  // Same contract as TanStack's injectQuery: an explicit injector waives the
  // context requirement, otherwise the framework's own error is thrown.
  assertInInjectionContext(debugFn);
  return inject(DestroyRef);
}

/**
 * A signal over one persisted session key.
 *
 * This is what makes `enabled` gates and cache keys react to login, logout and
 * a site switch. `injectQuery` re-runs its options callback in a reactive
 * context, so reading this signal *inside* that callback re-derives the key and
 * the gate; reading it outside freezes both at creation time.
 *
 * React solves the same problem with `useSyncExternalStore`, and its comment
 * records the failure it fixed: raw `storage.getCustomerToken()` reads in hook
 * bodies "never re-rendered on login/logout — `enabled` gates stayed stale
 * until an unrelated re-render".
 *
 * A storage without `subscribeAll` is non-reactive, matching React's behaviour
 * for the same case.
 */
export function storageSignal<T>(
  storage: EmporixStorage,
  key: EmporixStorageKey,
  read: (s: EmporixStorage) => T,
  opts: { injector?: Injector } = {},
): Signal<T> {
  const value = signal<T>(read(storage));
  const stop = storage.subscribeAll?.((changed) => {
    if (changed === key) value.set(read(storage));
  });
  if (stop !== undefined) {
    destroyRefFrom(opts.injector, storageSignal).onDestroy(stop);
  }
  return value.asReadonly();
}

/**
 * The stored customer token, as a signal.
 *
 * Routed through the shared customer-session store rather than `subscribeAll`,
 * matching React: the store is the one place that also holds the in-memory
 * `refreshToken` and `saasToken`, and it mirrors external token writes from any
 * consumer. One store per storage instance, so a login anywhere is visible
 * everywhere.
 */
export function customerTokenSignal(
  storage: EmporixStorage,
  opts: { injector?: Injector } = {},
): Signal<string | null> {
  const store = getCustomerSessionStore(storage);
  const value = signal<string | null>(store.getSnapshot().token);
  const stop = store.subscribe(() => value.set(store.getSnapshot().token));
  destroyRefFrom(opts.injector, customerTokenSignal).onDestroy(stop);
  return value.asReadonly();
}

/** The active guest-or-customer cart id, as a signal. */
export function cartIdSignal(
  storage: EmporixStorage,
  opts: { injector?: Injector } = {},
): Signal<string | null> {
  return storageSignal(storage, "cartId", (s) => s.getCartId(), opts);
}
```

- [ ] **Step 4: Run the tests**

```bash
pnpm -F @viu/emporix-sdk-angular exec vitest run tests/storage-signal.test.ts
```

Expected: 7 passed.

**If the teardown test fails** because `Injector.create` does not provide a `DestroyRef` or has no `destroy()`: replace that one test's injector with `TestBed.inject(EnvironmentInjector)` and drive destruction with `TestBed.resetTestingModule()`, and note in the test comment which mechanism was used. Do not delete the test — listener accumulation on a long-lived storage is a real leak, and this is the only thing asserting it.

- [ ] **Step 5: Export and verify**

Add to `packages/angular/src/index.ts`:

```ts
export { storageSignal, customerTokenSignal, cartIdSignal } from "./storage-signal";
```

```bash
pnpm -F @viu/emporix-sdk-angular test
pnpm -F @viu/emporix-sdk-angular lint
pnpm -F @viu/emporix-sdk-angular typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/angular
git commit -m "feat(angular): add storageSignal for reactive session state

injectQuery re-runs its options callback in a reactive context, so a signal
read inside that callback re-derives the cache key and the enabled gate on
login and logout. A one-shot storage read freezes both at page-load state, and
the symptom is a customer who logs out and still sees their orders.

customerTokenSignal routes through the shared customer-session store rather
than subscribeAll, matching React: the store also holds the in-memory refresh
and saas tokens and mirrors external writes, so one login is visible
everywhere.

The optional { injector } escape hatch mirrors TanStack's own injectQuery
signature rather than inventing a second convention. Teardown through
DestroyRef is tested, because listener accumulation on a long-lived storage
leaks for the page's lifetime.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: `injectEmporixQuery` and `injectEmporixInfinite`

Where the pure core, the signals and TanStack meet. The one detail that matters more than all the others: the signal reads go **inside** the `injectQuery` options callback.

**Files:**
- Create: `packages/angular/src/inject-query.ts`
- Test: `packages/angular/tests/inject-query.test.ts`

**Interfaces:**
- Consumes: `emporixQueryOptions`, `EmporixQueryInput` (Task 4); `customerTokenSignal` (Task 5); `injectEmporix` (Task 1); `injectQuery`, `injectInfiniteQuery`, `CreateQueryResult`, `CreateInfiniteQueryResult` from `@tanstack/angular-query-experimental`.
- Produces:
  - `injectEmporixQuery<T, TArgs>(input: () => EmporixQueryInput<T, TArgs>, opts?: { injector?: Injector }): CreateQueryResult<T>`
  - `injectEmporixInfinite<T, TArgs>(input: () => EmporixInfiniteInput<T, TArgs>, opts?: { injector?: Injector }): CreateInfiniteQueryResult<T>`
  - `interface EmporixInfiniteInput<T, TArgs>` — `EmporixQueryInput` plus `getNextPageParam: (last: T, all: T[]) => unknown`, `initialPageParam: unknown`

**Note on site signals:** this task reads `siteCode` and `language` as `null`. Task 7 introduces the real site signals and replaces those two lines. Keeping the dependency one-directional means this task can be reviewed and merged without the site work.

---

- [ ] **Step 1: Write the failing test**

Create `packages/angular/tests/inject-query.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationRef } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { QueryClient } from "@tanstack/angular-query-experimental";
import { createMemoryStorage } from "@viu/emporix-sdk";
import { provideEmporix } from "../src/provide";
import { injectEmporixQuery } from "../src/inject-query";

const fakeClient = { tenant: "acme" } as never;

/** Let TanStack's internal effect flush and the observer settle. */
async function settle(): Promise<void> {
  TestBed.inject(ApplicationRef).tick();
  await new Promise((r) => setTimeout(r, 0));
}

describe("injectEmporixQuery", () => {
  let storage: ReturnType<typeof createMemoryStorage>;
  let queryClient: QueryClient;

  beforeEach(() => {
    storage = createMemoryStorage();
    queryClient = new QueryClient();
    TestBed.configureTestingModule({
      providers: [provideEmporix({ client: fakeClient, storage, queryClient })],
    });
  });

  it("fetches and exposes the result", async () => {
    const queryFn = vi.fn(async () => "p1-data");
    const query = TestBed.runInInjectionContext(() =>
      injectEmporixQuery(() => ({
        resource: "product",
        args: ["p1"] as const,
        site: "none" as const,
        mode: "read-auth" as const,
        queryFn,
      })),
    );
    await settle();
    expect(query.data()).toBe("p1-data");
    expect(queryFn).toHaveBeenCalledOnce();
  });

  it("does not fetch a customer-gated read without a token", async () => {
    const queryFn = vi.fn(async () => "orders");
    TestBed.runInInjectionContext(() =>
      injectEmporixQuery(() => ({
        resource: "my-orders",
        args: [] as const,
        site: "none" as const,
        mode: "customer" as const,
        queryFn,
      })),
    );
    await settle();
    expect(queryFn).not.toHaveBeenCalled();
  });

  /**
   * The reason this whole package uses signals. The token must be read INSIDE
   * injectQuery's options callback; read outside, the gate is evaluated once and
   * a customer who logs in never gets their data.
   */
  it("re-enables a customer-gated read when a token appears", async () => {
    const queryFn = vi.fn(async () => "orders");
    const query = TestBed.runInInjectionContext(() =>
      injectEmporixQuery(() => ({
        resource: "my-orders",
        args: [] as const,
        site: "none" as const,
        mode: "customer" as const,
        queryFn,
      })),
    );
    await settle();
    expect(queryFn).not.toHaveBeenCalled();

    storage.setCustomerToken("t1");
    await settle();
    expect(queryFn).toHaveBeenCalledOnce();
    expect(query.data()).toBe("orders");
  });

  it("re-keys a read-auth query on login, so anonymous data is not reused", async () => {
    const queryFn = vi.fn(async () => "data");
    TestBed.runInInjectionContext(() =>
      injectEmporixQuery(() => ({
        resource: "product",
        args: ["p1"] as const,
        site: "none" as const,
        mode: "read-auth" as const,
        queryFn,
      })),
    );
    await settle();
    storage.setCustomerToken("t1");
    await settle();

    const keys = queryClient
      .getQueryCache()
      .getAll()
      .map((q) => (q.queryKey[3] as { authKind: string }).authKind);
    expect(keys).toContain("anonymous");
    expect(keys).toContain("customer");
  });

  it("accepts an explicit injector outside an injection context", async () => {
    const injector = TestBed.inject(ApplicationRef).injector;
    const query = injectEmporixQuery(
      () => ({
        resource: "product",
        args: ["p1"] as const,
        site: "none" as const,
        mode: "read-auth" as const,
        queryFn: async () => "v",
      }),
      { injector },
    );
    await settle();
    expect(query.data()).toBe("v");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
pnpm -F @viu/emporix-sdk-angular exec vitest run tests/inject-query.test.ts
```

Expected: FAIL — `Cannot find module '../src/inject-query'`.

- [ ] **Step 3: Write the implementation**

Create `packages/angular/src/inject-query.ts`:

```ts
import {
  assertInInjectionContext,
  inject,
  runInInjectionContext,
  Injector,
} from "@angular/core";
import {
  injectInfiniteQuery,
  injectQuery,
  type CreateInfiniteQueryResult,
  type CreateQueryResult,
} from "@tanstack/angular-query-experimental";
import { injectEmporix } from "./provide";
import { customerTokenSignal } from "./storage-signal";
import { emporixQueryOptions, type EmporixQueryInput } from "./query-options";

export interface EmporixInfiniteInput<T, TArgs extends readonly unknown[]>
  extends EmporixQueryInput<T, TArgs> {
  getNextPageParam: (lastPage: T, allPages: T[]) => unknown;
  initialPageParam: unknown;
}

/**
 * A read against Emporix, keyed and auth-resolved by {@link emporixQueryOptions}.
 *
 * `input` is a FUNCTION, matching `injectQuery`'s own contract: it runs in a
 * reactive context on every dependency change, so an `args` array derived from
 * a signal re-keys the query without any extra wiring.
 *
 * @example
 * ```ts
 * class ProductPage {
 *   id = signal("p1")
 *   product = injectEmporixQuery(() => ({
 *     resource: "product",
 *     args: [this.id()],
 *     site: "full",
 *     mode: "read-auth",
 *     queryFn: (ctx) => this.client.products.get(this.id(), undefined, ctx),
 *   }))
 * }
 * ```
 */
export function injectEmporixQuery<T, TArgs extends readonly unknown[]>(
  input: () => EmporixQueryInput<T, TArgs>,
  opts: { injector?: Injector } = {},
): CreateQueryResult<T> {
  if (opts.injector === undefined) assertInInjectionContext(injectEmporixQuery);
  const injector = opts.injector ?? inject(Injector);
  return runInInjectionContext(injector, () => {
    const { client, storage } = injectEmporix();
    const token = customerTokenSignal(storage, { injector });
    return injectQuery(
      () =>
        emporixQueryOptions(input(), {
          tenant: client.tenant,
          // Read INSIDE this callback, never outside it. injectQuery runs the
          // callback in a reactive context, so this read is what makes the
          // cache key and the `enabled` gate follow login and logout. Hoisting
          // it above the callback compiles, passes a happy-path test, and
          // leaves a logged-out customer looking at their own orders.
          token: token(),
          // Task 7 replaces these two with the real site signals.
          siteCode: null,
          language: null,
        }),
      { injector },
    );
  });
}

/** The paginated form. Same contract, plus TanStack's two page-param fields. */
export function injectEmporixInfinite<T, TArgs extends readonly unknown[]>(
  input: () => EmporixInfiniteInput<T, TArgs>,
  opts: { injector?: Injector } = {},
): CreateInfiniteQueryResult<T> {
  if (opts.injector === undefined) assertInInjectionContext(injectEmporixInfinite);
  const injector = opts.injector ?? inject(Injector);
  return runInInjectionContext(injector, () => {
    const { client, storage } = injectEmporix();
    const token = customerTokenSignal(storage, { injector });
    return injectInfiniteQuery(
      () => {
        const cfg = input();
        return {
          ...emporixQueryOptions(cfg, {
            tenant: client.tenant,
            token: token(),
            siteCode: null,
            language: null,
          }),
          getNextPageParam: cfg.getNextPageParam,
          initialPageParam: cfg.initialPageParam,
        };
      },
      { injector },
    ) as CreateInfiniteQueryResult<T>;
  });
}
```

- [ ] **Step 4: Run the tests**

```bash
pnpm -F @viu/emporix-sdk-angular exec vitest run tests/inject-query.test.ts
```

Expected: 6 passed.

**If a query never resolves** (`query.data()` stays `undefined` and the test times out), the effect is not flushing. Try, in order: (a) `await TestBed.inject(ApplicationRef).whenStable()` instead of `tick()` + `setTimeout`; (b) add `provideZonelessChangeDetection()` to the testing module's providers and drop the `zone.js/testing` import from `vitest.setup.ts`. Record which one worked in the `settle()` helper's comment — every later task's tests reuse it.

**If `tsc` rejects the options object**, the cause is `emporixQueryOptions`
returning `queryKey: readonly unknown[]` where TanStack wants its own `QueryKey`
(and, in newer versions, a `DataTag`-branded key). Fix it in **Task 4**, not
here, by importing `QueryKey` from `@tanstack/angular-query-experimental` and
narrowing the return type — the pure function is the right place for the
contract, and patching it with a cast at each call site would hide the same
mismatch from `injectEmporixInfinite`. The `as CreateInfiniteQueryResult<T>` cast
already in the infinite variant exists for the analogous reason and should be
removed if the narrowing makes it unnecessary.

- [ ] **Step 5: Export, verify, commit**

Add to `packages/angular/src/index.ts`:

```ts
export { injectEmporixQuery, injectEmporixInfinite } from "./inject-query";
export type { EmporixInfiniteInput } from "./inject-query";
```

```bash
pnpm -F @viu/emporix-sdk-angular test
pnpm -F @viu/emporix-sdk-angular lint
pnpm -F @viu/emporix-sdk-angular typecheck
pnpm -F @viu/emporix-sdk-angular build && pnpm -F @viu/emporix-sdk-angular check:dist
```

```bash
git add packages/angular
git commit -m "feat(angular): add injectEmporixQuery and injectEmporixInfinite

The signal reads sit inside injectQuery's options callback, which is the only
place they work: injectQuery runs that callback in a reactive context, so the
read is what makes the cache key and the enabled gate follow login and logout.
Hoisting it above the callback compiles and passes a happy-path test, then
leaves a logged-out customer looking at their own orders — so there is a test
for the login transition specifically, not just for the fetch.

input is a function rather than a value, matching injectQuery's own contract,
so signal-derived args re-key the query with no extra wiring.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Site signals — read side

React resolves the active site in a documented order: prop → storage → client config → `null`, then fetches the site DTO once on mount to fill in `currency`, `targetLocation` and a default `language`. This task ports the read half.

**Files:**
- Create: `packages/angular/src/site.ts`
- Modify: `packages/angular/src/tokens.ts` (add `EMPORIX_SITE`), `src/provide.ts` (provide it), `src/inject-query.ts` (use the real signals)
- Test: `packages/angular/tests/site.test.ts`

**Interfaces:**
- Consumes: `EMPORIX_CLIENT`, `EMPORIX_STORAGE` (Task 1); `storageSignal` (Task 5).
- Produces:
  - `EMPORIX_SITE: InjectionToken<EmporixSiteState>`
  - `interface EmporixSiteState { siteCode: Signal<string | null>; currency: Signal<string | null>; language: Signal<string | null>; targetLocation: Signal<string | null>; isSwitching: Signal<boolean>; switchError: Signal<Error | null> }`
  - `injectEmporixSite(): EmporixSiteState`
  - `createSiteState(client, storage, init: { siteCode?: string; language?: string }): EmporixSiteState & { readonly internal: SiteStateWritables }` where `SiteStateWritables` exposes `WritableSignal` handles for Task 8
  - `EmporixConfig` gains `initialSiteCode?: string` and `initialLanguage?: string`

---

- [ ] **Step 1: Write the failing test**

Create `packages/angular/tests/site.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TestBed } from "@angular/core/testing";
import { createMemoryStorage } from "@viu/emporix-sdk";
import { provideEmporix } from "../src/provide";
import { injectEmporixSite } from "../src/site";

function clientWith(context: Record<string, string> = {}) {
  return {
    tenant: "acme",
    config: { credentials: { storefront: { context } } },
    sites: { get: async () => ({ currency: "CHF", defaultLanguage: "de", languages: ["de", "fr"], homeBase: { address: { country: "CH" } } }) },
    setStorefrontContext: () => {},
  } as never;
}

describe("site resolution order", () => {
  it("prefers an explicit initialSiteCode", () => {
    const storage = createMemoryStorage();
    storage.setSiteCode("from-storage");
    TestBed.configureTestingModule({
      providers: [provideEmporix({ client: clientWith({ siteCode: "from-config" }), storage, initialSiteCode: "explicit" })],
    });
    expect(TestBed.runInInjectionContext(() => injectEmporixSite()).siteCode()).toBe("explicit");
  });

  it("falls back to storage", () => {
    const storage = createMemoryStorage();
    storage.setSiteCode("from-storage");
    TestBed.configureTestingModule({
      providers: [provideEmporix({ client: clientWith({ siteCode: "from-config" }), storage })],
    });
    expect(TestBed.runInInjectionContext(() => injectEmporixSite()).siteCode()).toBe("from-storage");
  });

  it("falls back to the client's storefront context", () => {
    TestBed.configureTestingModule({
      providers: [provideEmporix({ client: clientWith({ siteCode: "from-config" }), storage: createMemoryStorage() })],
    });
    expect(TestBed.runInInjectionContext(() => injectEmporixSite()).siteCode()).toBe("from-config");
  });

  it("is null when nothing resolves", () => {
    TestBed.configureTestingModule({
      providers: [provideEmporix({ client: clientWith(), storage: createMemoryStorage() })],
    });
    expect(TestBed.runInInjectionContext(() => injectEmporixSite()).siteCode()).toBeNull();
  });

  it("applies the same order to language", () => {
    const storage = createMemoryStorage();
    storage.setLanguage("fr");
    TestBed.configureTestingModule({
      providers: [provideEmporix({ client: clientWith({ language: "it" }), storage })],
    });
    expect(TestBed.runInInjectionContext(() => injectEmporixSite()).language()).toBe("fr");
  });
});

describe("mount-time derivation from the site DTO", () => {
  it("fills currency, targetLocation and a default language", async () => {
    TestBed.configureTestingModule({
      providers: [provideEmporix({ client: clientWith({ siteCode: "main" }), storage: createMemoryStorage() })],
    });
    const site = TestBed.runInInjectionContext(() => injectEmporixSite());
    await new Promise((r) => setTimeout(r, 0));
    expect(site.currency()).toBe("CHF");
    expect(site.targetLocation()).toBe("CH");
    expect(site.language()).toBe("de");
  });

  it("does not override a currency already seeded from the client config", async () => {
    // The persisted or configured choice wins; derivation only fills nulls.
    TestBed.configureTestingModule({
      providers: [provideEmporix({ client: clientWith({ siteCode: "main", currency: "EUR" }), storage: createMemoryStorage() })],
    });
    const site = TestBed.runInInjectionContext(() => injectEmporixSite());
    await new Promise((r) => setTimeout(r, 0));
    expect(site.currency()).toBe("EUR");
  });

  it("stays silent when the site fetch fails", async () => {
    const client = { ...clientWith({ siteCode: "main" }) } as unknown as {
      sites: { get: () => Promise<never> };
    };
    client.sites = { get: () => Promise.reject(new Error("502")) };
    TestBed.configureTestingModule({
      providers: [provideEmporix({ client: client as never, storage: createMemoryStorage() })],
    });
    const site = TestBed.runInInjectionContext(() => injectEmporixSite());
    await new Promise((r) => setTimeout(r, 0));
    // Best-effort, exactly like React: a failed derivation leaves nulls rather
    // than surfacing an error the user cannot act on. switchError is reserved
    // for user-initiated switches.
    expect(site.currency()).toBeNull();
    expect(site.switchError()).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
pnpm -F @viu/emporix-sdk-angular exec vitest run tests/site.test.ts
```

Expected: FAIL — `Cannot find module '../src/site'`.

- [ ] **Step 3: Add the token**

Append to `packages/angular/src/tokens.ts`:

```ts
// Type-only import, so the tokens ↔ site cycle is erased at compile time:
// site.ts imports the VALUE `EMPORIX_SITE` from here, this file imports only
// TYPES from there. `verbatimModuleSyntax` guarantees `import type` emits
// nothing, so there is no runtime cycle. Do not "fix" this by turning it into a
// value import — that would create a real one.
import type { EmporixSiteState, SiteStateWritables } from "./site";

/** Active site, currency and language. Always provided by `provideEmporix`. */
export const EMPORIX_SITE = new InjectionToken<EmporixSiteState>("EMPORIX_SITE");

/**
 * Writable handles for the same state, consumed only by `site-switch.ts`.
 * Deliberately NOT exported from `src/index.ts`: a consumer who can write
 * `siteCode` directly bypasses the cart drop and the session-context patch.
 */
export const EMPORIX_SITE_INTERNAL = new InjectionToken<SiteStateWritables>(
  "EMPORIX_SITE_INTERNAL",
);
```

- [ ] **Step 4: Write the site state**

Create `packages/angular/src/site.ts`:

```ts
import { inject, signal, type Signal, type WritableSignal } from "@angular/core";
import { auth, type EmporixClient, type EmporixStorage } from "@viu/emporix-sdk";
import { EMPORIX_SITE } from "./tokens";

/** The active site, as read by consumers. */
export interface EmporixSiteState {
  siteCode: Signal<string | null>;
  currency: Signal<string | null>;
  language: Signal<string | null>;
  targetLocation: Signal<string | null>;
  isSwitching: Signal<boolean>;
  switchError: Signal<Error | null>;
}

/** Writable handles, for the switch functions in `site-switch.ts`. */
export interface SiteStateWritables {
  siteCode: WritableSignal<string | null>;
  currency: WritableSignal<string | null>;
  language: WritableSignal<string | null>;
  targetLocation: WritableSignal<string | null>;
  isSwitching: WritableSignal<boolean>;
  switchError: WritableSignal<Error | null>;
}

export type EmporixSiteInternal = EmporixSiteState & { internal: SiteStateWritables };

/**
 * Resolve and derive the active site.
 *
 * Resolution order, matching React exactly: explicit init value → storage →
 * `client.config.credentials.storefront.context` → `null`.
 *
 * Then one best-effort fetch of the site DTO to fill in `currency`,
 * `targetLocation` and a default `language`. Only fields still `null` are
 * filled: a currency seeded from config or storage is the user's choice and
 * outranks the site default. A failed fetch is silent — `switchError` is
 * reserved for switches the user initiated and can retry.
 */
export function createSiteState(
  client: EmporixClient,
  storage: EmporixStorage,
  init: { siteCode?: string; language?: string },
): EmporixSiteInternal {
  const ctx = client.config?.credentials?.storefront?.context;

  const siteCode = signal<string | null>(
    init.siteCode ?? storage.getSiteCode() ?? ctx?.siteCode ?? null,
  );
  const currency = signal<string | null>(ctx?.currency ?? null);
  const language = signal<string | null>(
    init.language ?? storage.getLanguage() ?? ctx?.language ?? null,
  );
  const targetLocation = signal<string | null>(null);
  const isSwitching = signal(false);
  const switchError = signal<Error | null>(null);

  // Push the resolved language to the SDK so the very first reads carry
  // Accept-Language. Signal state alone never reaches the client.
  const initialLanguage = language();
  if (initialLanguage !== null) client.setStorefrontContext({ language: initialLanguage });

  const code = siteCode();
  if (code !== null && (currency() === null || language() === null || targetLocation() === null)) {
    const token = storage.getCustomerToken();
    void client.sites
      .get(code, token !== null ? auth.customer(token) : auth.anonymous())
      .then((site) => {
        if (currency() === null) currency.set(site.currency);
        targetLocation.set(site.homeBase?.address?.country ?? null);
        if (language() === null && site.defaultLanguage) {
          language.set(site.defaultLanguage);
          client.setStorefrontContext({ language: site.defaultLanguage });
        }
      })
      .catch(() => {
        // Best-effort. A user-initiated switch surfaces real errors through
        // switchError; this one has no action attached to it.
      });
  }

  const writables: SiteStateWritables = {
    siteCode,
    currency,
    language,
    targetLocation,
    isSwitching,
    switchError,
  };
  return {
    siteCode: siteCode.asReadonly(),
    currency: currency.asReadonly(),
    language: language.asReadonly(),
    targetLocation: targetLocation.asReadonly(),
    isSwitching: isSwitching.asReadonly(),
    switchError: switchError.asReadonly(),
    internal: writables,
  };
}

/** The active site state. Must be called in an injection context. */
export function injectEmporixSite(): EmporixSiteState {
  return inject(EMPORIX_SITE);
}
```

- [ ] **Step 5: Provide it and wire the query context**

In `packages/angular/src/provide.ts`, add the two init fields to `EmporixConfig`:

```ts
  /** Initial site code. Order: this → storage → client config → null. */
  initialSiteCode?: string;
  /** Initial language. Order: this → storage → client config → null. */
  initialLanguage?: string;
```

and inside `provideEmporix`, before the `return`:

```ts
  const site = createSiteState(config.client, storage, {
    ...(config.initialSiteCode !== undefined ? { siteCode: config.initialSiteCode } : {}),
    ...(config.initialLanguage !== undefined ? { language: config.initialLanguage } : {}),
  });
```

adding both of these to the provider array (both tokens were declared in Step 3):

```ts
    { provide: EMPORIX_SITE, useValue: site },
    { provide: EMPORIX_SITE_INTERNAL, useValue: site.internal },
```

Then in `packages/angular/src/inject-query.ts`, replace the two placeholder lines in **both** functions:

```ts
        const site = injectEmporixSite();
        // ...
          siteCode: site.siteCode(),
          language: site.language(),
```

`injectEmporixSite()` is called once outside the options callback (it is a DI read, not reactive state); the two signal *reads* stay inside it, for the same reason `token()` does.

- [ ] **Step 6: Run everything**

```bash
pnpm -F @viu/emporix-sdk-angular exec vitest run tests/site.test.ts
pnpm -F @viu/emporix-sdk-angular test
```

Expected: 8 site tests pass, and the Task 6 suite still passes — its `site: "none"` cases are unaffected by real site signals.

- [ ] **Step 7: Export, verify, commit**

Add to `packages/angular/src/index.ts`:

```ts
export { injectEmporixSite } from "./site";
export type { EmporixSiteState } from "./site";
export { EMPORIX_SITE } from "./tokens";
```

```bash
pnpm -F @viu/emporix-sdk-angular lint && pnpm -F @viu/emporix-sdk-angular typecheck
git add packages/angular
git commit -m "feat(angular): add the site signals and wire them into the query context

Ports React's resolution order verbatim — explicit init, then storage, then
the client's storefront context, then null — and the one best-effort site-DTO
fetch that fills currency, targetLocation and a default language. Only fields
still null are filled: a currency from config or storage is the user's choice
and outranks the site default.

A failed derivation stays silent, matching React. switchError is reserved for
switches a user initiated and can retry; surfacing a mount-time 502 there
would put an error in front of a user with no action attached to it.

injectEmporixSite is read once outside injectQuery's options callback because
it is a DI lookup; the siteCode() and language() reads stay inside it, for the
same reason token() does.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Site signals — write side

`setSite`, `setCurrency` and `setLanguage`. Each flips local state optimistically, invalidates the cache, then does server work whose failure surfaces in `switchError` **without** rolling the optimistic state back — the cache is already invalidated and the UI has already moved.

**Files:**
- Create: `packages/angular/src/site-switch.ts`
- Test: `packages/angular/tests/site-switch.test.ts`

**Interfaces:**
- Consumes: `EMPORIX_SITE_INTERNAL`, `EMPORIX_CLIENT`, `EMPORIX_STORAGE` (Tasks 1, 7); `injectQueryClient` from `@tanstack/angular-query-experimental`.
- Produces: `injectEmporixSiteSwitch(): { setSite(code: string | null): Promise<void>; setCurrency(c: string): Promise<void>; setLanguage(l: string): Promise<void> }`

---

- [ ] **Step 1: Write the failing test**

Create `packages/angular/tests/site-switch.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { TestBed } from "@angular/core/testing";
import { QueryClient } from "@tanstack/angular-query-experimental";
import { createMemoryStorage } from "@viu/emporix-sdk";
import { provideEmporix } from "../src/provide";
import { injectEmporixSite } from "../src/site";
import { injectEmporixSiteSwitch } from "../src/site-switch";

function setup(overrides: { patch?: () => Promise<unknown>; get?: () => Promise<unknown> } = {}) {
  const storage = createMemoryStorage();
  const queryClient = new QueryClient();
  const setStorefrontContext = vi.fn();
  const patch = vi.fn(overrides.patch ?? (async () => true));
  const client = {
    tenant: "acme",
    config: { credentials: { storefront: { context: { siteCode: "main" } } } },
    sites: {
      get: overrides.get ?? (async () => ({
        currency: "CHF",
        defaultLanguage: "de",
        languages: ["de", "fr"],
        homeBase: { address: { country: "CH" } },
      })),
    },
    sessionContext: { patch },
    setStorefrontContext,
  } as never;
  TestBed.configureTestingModule({
    providers: [provideEmporix({ client, storage, queryClient })],
  });
  const ctx = TestBed.runInInjectionContext(() => ({
    site: injectEmporixSite(),
    switcher: injectEmporixSiteSwitch(),
  }));
  return { ...ctx, storage, queryClient, patch, setStorefrontContext };
}

describe("setSite", () => {
  it("flips local state and storage immediately, before any server work", async () => {
    const { site, switcher, storage } = setup();
    const pending = switcher.setSite("other");
    // Optimistic: asserted before the await, which is the whole point.
    expect(site.siteCode()).toBe("other");
    expect(storage.getSiteCode()).toBe("other");
    await pending;
  });

  it("drops the cart id — carts are site-bound", async () => {
    const { switcher, storage } = setup();
    storage.setCartId("c1");
    await switcher.setSite("other");
    expect(storage.getCartId()).toBeNull();
  });

  it("derives currency and targetLocation, then patches the session context", async () => {
    const { site, switcher, patch } = setup();
    await switcher.setSite("other");
    expect(site.currency()).toBe("CHF");
    expect(site.targetLocation()).toBe("CH");
    expect(patch).toHaveBeenCalledWith(
      expect.objectContaining({ siteCode: "other", currency: "CHF", targetLocation: "CH" }),
      expect.anything(),
    );
  });

  it("clears currency and target for a null site without server work", async () => {
    const { site, switcher, patch } = setup();
    await switcher.setSite(null);
    expect(site.siteCode()).toBeNull();
    expect(site.currency()).toBeNull();
    expect(patch).not.toHaveBeenCalled();
  });

  it("surfaces a patch failure in switchError WITHOUT rolling back", async () => {
    const { site, switcher } = setup({ patch: async () => { throw new Error("patch failed"); } });
    await switcher.setSite("other");
    expect(site.switchError()?.message).toBe("patch failed");
    // No rollback: the cache is already invalidated and the UI already moved.
    // Reverting here would show the user a site they did not choose.
    expect(site.siteCode()).toBe("other");
    expect(site.isSwitching()).toBe(false);
  });
});

describe("setCurrency", () => {
  it("re-binds the anonymous price context so guest pricing changes pre-cart", async () => {
    const { switcher, setStorefrontContext } = setup();
    await switcher.setCurrency("EUR");
    expect(setStorefrontContext).toHaveBeenCalledWith({ currency: "EUR" });
  });

  it("drops the currency-bound guest cart", async () => {
    const { switcher, storage } = setup();
    storage.setCartId("c1");
    await switcher.setCurrency("EUR");
    expect(storage.getCartId()).toBeNull();
  });
});

describe("setLanguage", () => {
  it("persists, sets the Accept-Language source, and does NOT drop the cart", async () => {
    const { site, switcher, storage, setStorefrontContext } = setup();
    storage.setCartId("c1");
    await switcher.setLanguage("fr");
    expect(site.language()).toBe("fr");
    expect(storage.getLanguage()).toBe("fr");
    expect(setStorefrontContext).toHaveBeenCalledWith({ language: "fr" });
    // Language does not affect pricing, so the cart survives.
    expect(storage.getCartId()).toBe("c1");
  });
});

describe("cache invalidation", () => {
  it("invalidates the whole emporix namespace on a switch", async () => {
    const { switcher, queryClient } = setup();
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await switcher.setLanguage("fr");
    expect(spy).toHaveBeenCalledWith({ queryKey: ["emporix"] });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
pnpm -F @viu/emporix-sdk-angular exec vitest run tests/site-switch.test.ts
```

Expected: FAIL — `Cannot find module '../src/site-switch'`.

- [ ] **Step 3: Write the implementation**

Create `packages/angular/src/site-switch.ts`:

```ts
import { inject } from "@angular/core";
import { injectQueryClient } from "@tanstack/angular-query-experimental";
import { auth, type AuthContext, type EmporixClient, type EmporixStorage } from "@viu/emporix-sdk";
import { EMPORIX_CLIENT, EMPORIX_SITE_INTERNAL, EMPORIX_STORAGE } from "./tokens";
import type { SiteStateWritables } from "./site";

/**
 * The `isSwitching`-bracketed async tail shared by all three switches: flip the
 * in-flight flag, await the server work, surface a failure via `switchError`
 * WITHOUT rolling back the already-applied optimistic state.
 *
 * No rollback is deliberate: by the time the server work fails, the cache has
 * been invalidated and the UI has moved on. Reverting would show the user a
 * site or currency they did not choose.
 */
async function runSwitch(work: () => Promise<unknown>, w: SiteStateWritables): Promise<void> {
  w.isSwitching.set(true);
  try {
    await work();
  } catch (e) {
    w.switchError.set(e instanceof Error ? e : new Error(String(e)));
  } finally {
    w.isSwitching.set(false);
  }
}

const ctxFor = (storage: EmporixStorage): AuthContext => {
  const token = storage.getCustomerToken();
  return token !== null ? auth.customer(token) : auth.anonymous();
};

export interface EmporixSiteSwitch {
  /** Switch the active site. `null` unbinds it. Optimistic; cart is dropped. */
  setSite(code: string | null): Promise<void>;
  /** Switch currency. Must be in the active site's `availableCurrencies`. */
  setCurrency(currency: string): Promise<void>;
  /** Switch language. Does not touch the cart — language does not affect price. */
  setLanguage(language: string): Promise<void>;
}

/** The site mutation API. Must be called in an injection context. */
export function injectEmporixSiteSwitch(): EmporixSiteSwitch {
  const client: EmporixClient = inject(EMPORIX_CLIENT);
  const storage: EmporixStorage = inject(EMPORIX_STORAGE);
  const w = inject(EMPORIX_SITE_INTERNAL);
  const qc = injectQueryClient();

  const siteDto = (code: string) => client.sites.get(code, ctxFor(storage));

  return {
    async setSite(code) {
      storage.setSiteCode(code);
      // Carts are site-bound: keeping one across a switch prices it wrongly.
      storage.setCartId(null);
      w.siteCode.set(code);
      w.switchError.set(null);
      void qc.invalidateQueries({ queryKey: ["emporix"] });

      if (code === null) {
        w.currency.set(null);
        w.targetLocation.set(null);
        return;
      }

      await runSwitch(async () => {
        const site = await siteDto(code);
        const nextCurrency = site.currency;
        const nextTarget = site.homeBase?.address?.country ?? null;
        w.currency.set(nextCurrency);
        w.targetLocation.set(nextTarget);
        // Reset the language if the new site does not offer the active one.
        if (site.languages && !site.languages.includes(w.language() ?? "") && site.defaultLanguage) {
          w.language.set(site.defaultLanguage);
          client.setStorefrontContext({ language: site.defaultLanguage });
        }
        await client.sessionContext.patch(
          {
            siteCode: code,
            ...(nextCurrency ? { currency: nextCurrency } : {}),
            ...(nextTarget ? { targetLocation: nextTarget } : {}),
          },
          ctxFor(storage),
        );
      }, w);
    },

    async setCurrency(currency) {
      // Carts are currency-bound — drop it so a fresh one is created.
      storage.setCartId(null);
      w.currency.set(currency);
      w.switchError.set(null);
      // Re-bind the anonymous price context so guest pricing changes even
      // before a session or cart exists; sessionContext.patch cannot do that.
      client.setStorefrontContext({ currency });
      void qc.invalidateQueries({ queryKey: ["emporix"] });
      await runSwitch(async () => {
        const code = w.siteCode();
        await client.sessionContext.patch(
          { currency, ...(code !== null ? { siteCode: code } : {}) },
          ctxFor(storage),
        );
      }, w);
    },

    async setLanguage(language) {
      storage.setLanguage(language);
      w.language.set(language);
      w.switchError.set(null);
      // The Accept-Language source — applies to anonymous and pre-session reads.
      client.setStorefrontContext({ language });
      void qc.invalidateQueries({ queryKey: ["emporix"] });
      await runSwitch(async () => {
        const code = w.siteCode();
        await client.sessionContext.patch(
          { language, ...(code !== null ? { siteCode: code } : {}) },
          ctxFor(storage),
        );
      }, w);
    },
  };
}
```

- [ ] **Step 4: Run, export, verify, commit**

```bash
pnpm -F @viu/emporix-sdk-angular exec vitest run tests/site-switch.test.ts
```

Expected: 10 passed.

Add to `packages/angular/src/index.ts`:

```ts
export { injectEmporixSiteSwitch } from "./site-switch";
export type { EmporixSiteSwitch } from "./site-switch";
```

```bash
pnpm -F @viu/emporix-sdk-angular test
pnpm -F @viu/emporix-sdk-angular lint && pnpm -F @viu/emporix-sdk-angular typecheck
git add packages/angular
git commit -m "feat(angular): add setSite, setCurrency and setLanguage

Each flips local state and storage optimistically, invalidates the emporix
cache namespace, then does its server work. A failed patch lands in
switchError and the optimistic state is NOT rolled back — by then the cache is
invalidated and the UI has moved, so reverting would show the user a site they
did not choose. There is a test asserting exactly that non-rollback.

setSite and setCurrency drop the cart id (carts are site- and currency-bound);
setLanguage does not, because language does not affect price. Tested in both
directions rather than assumed.

setCurrency also calls setStorefrontContext so guest pricing changes before any
session or cart exists — sessionContext.patch cannot reach that case.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: `injectCustomerSession`, entries, docs, changeset

Login, logout and registration, plus everything that makes the package publishable: the `./ssr` entry, `docs/angular.md`, the README, the workspace tables, and the changeset.

**Files:**
- Create: `packages/angular/src/customer-session.ts`, `docs/angular.md`
- Modify: `packages/angular/src/index.ts`, `src/ssr.ts`, `README.md`; `CLAUDE.md`; root `README.md`; `examples/README.md`
- Create: `.changeset/angular-package-foundation.md`
- Test: `packages/angular/tests/customer-session.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `injectCustomerSession(): EmporixCustomerSession` with `token: Signal<string | null>`, `isAuthenticated: Signal<boolean>`, `login(email, password): Promise<void>`, `logout(): Promise<void>`, `register(input): Promise<void>`, `isPending: Signal<boolean>`, `error: Signal<Error | null>`.

---

- [ ] **Step 1: Read the React implementation before writing the test**

```bash
cat packages/react/src/hooks/use-customer-session.ts
cat packages/react/src/hooks/internal/bootstrap-cart.ts
```

`CustomerSessionApi`'s exact method names, the SDK calls behind them, and the cart-onboarding step on login are all defined there. Port those semantics; do not invent new ones. Note in particular what happens to the guest cart on login — `bootstrap-cart.ts` is the merge path, and getting it wrong silently loses a cart.

- [ ] **Step 2: Write the failing test**

Create `packages/angular/tests/customer-session.test.ts`, asserting at minimum:

```ts
import { describe, expect, it, vi } from "vitest";
import { TestBed } from "@angular/core/testing";
import { QueryClient } from "@tanstack/angular-query-experimental";
import { createMemoryStorage } from "@viu/emporix-sdk";
import { provideEmporix } from "../src/provide";
import { injectCustomerSession } from "../src/customer-session";

function setup() {
  const storage = createMemoryStorage();
  const login = vi.fn(async () => ({ accessToken: "t1", refreshToken: "r1" }));
  const logout = vi.fn(async () => undefined);
  const client = {
    tenant: "acme",
    config: { credentials: { storefront: { context: {} } } },
    sites: { get: async () => ({ currency: "CHF" }) },
    customers: { login, logout },
  } as never;
  TestBed.configureTestingModule({
    providers: [provideEmporix({ client, storage, queryClient: new QueryClient() })],
  });
  const session = TestBed.runInInjectionContext(() => injectCustomerSession());
  return { session, storage, login, logout };
}

describe("injectCustomerSession", () => {
  it("starts unauthenticated with an empty storage", () => {
    const { session } = setup();
    expect(session.token()).toBeNull();
    expect(session.isAuthenticated()).toBe(false);
  });

  it("stores the token on login and flips isAuthenticated", async () => {
    const { session, storage } = setup();
    await session.login("a@b.ch", "pw");
    expect(storage.getCustomerToken()).toBe("t1");
    expect(session.isAuthenticated()).toBe(true);
  });

  it("clears the token on logout", async () => {
    const { session, storage } = setup();
    await session.login("a@b.ch", "pw");
    await session.logout();
    expect(storage.getCustomerToken()).toBeNull();
    expect(session.isAuthenticated()).toBe(false);
  });

  it("surfaces a login failure in error and stays unauthenticated", async () => {
    const { session, login } = setup();
    login.mockRejectedValueOnce(new Error("401"));
    await session.login("a@b.ch", "wrong").catch(() => {});
    expect(session.error()?.message).toBe("401");
    expect(session.isAuthenticated()).toBe(false);
  });

  it("never writes a password into storage", () => {
    // The one assertion worth making explicitly: a credential must not reach
    // any persisted key, whatever the login flow does internally.
    const { storage } = setup();
    const values = Object.values(storage).filter((v) => typeof v === "string");
    expect(values.some((v) => v.includes("pw"))).toBe(false);
  });
});
```

Extend with a `register` case once Step 1 has established that method's real signature.

- [ ] **Step 3: Run it to confirm it fails, then implement**

```bash
pnpm -F @viu/emporix-sdk-angular exec vitest run tests/customer-session.test.ts
```

Expected: FAIL — module not found. Then write `packages/angular/src/customer-session.ts` using `customerTokenSignal` for the reactive token, `getCustomerSessionStore` for the in-memory refresh and saas tokens, and `injectQueryClient().invalidateQueries({ queryKey: ["emporix"] })` after login and logout — an authenticated read must not be served a guest's cached answer.

- [ ] **Step 4: Fill in the `./ssr` entry**

Replace `packages/angular/src/ssr.ts`:

```ts
/**
 * Server-side rendering helpers.
 *
 * Angular SSR has no tag-based invalidation model, so there is no analogue to
 * `@viu/emporix-sdk-next`'s cache tags here. What this entry exists for is
 * hydration: `TransferState` and `makeStateKey` from `@angular/core`, used to
 * hand a server-rendered query result to the browser so it is not fetched
 * twice.
 *
 * The prefetch helpers themselves are not in this foundation — see
 * docs/superpowers/specs/2026-08-25-angular-package-design.md. This entry
 * exists now because a declared-but-missing export is a broken artifact, and
 * re-exporting the two primitives is what a consumer needs in the meantime.
 */
export { makeStateKey, TransferState } from "@angular/core";
export type { StateKey } from "@angular/core";
```

- [ ] **Step 5: Write `docs/angular.md`**

Cover: install and `provideEmporix`; the reactivity rule (**read signals inside the options callback**, with the wrong version shown alongside the right one — it is the mistake every consumer will make once); `injectEmporixQuery` and `injectEmporixInfinite` with a worked example; site switching; customer session; the `{ injector }` escape hatch; and a **"What is not here yet"** section naming the 74 excluded injectables **by area with the counts from the spec**, plus the deferred telemetry, token auto-refresh and B2B context. A doc that lists only what exists reads as complete.

- [ ] **Step 6: Update the workspace tables**

- `CLAUDE.md`: add `packages/angular` to the workspace-layout table, and a line under "Things that are easy to get wrong": *"In `@viu/emporix-sdk-angular`, signal reads must sit INSIDE `injectQuery`'s options callback. Read outside, the cache key and `enabled` gate freeze at creation time and a logged-out customer keeps seeing their own orders."*
- Root `README.md`: add the package to the package list.
- `examples/README.md`: add `angular-storefront`, stating that its job is to prove the tsup artifact survives an AOT production build.

- [ ] **Step 7: Write the changeset**

Create `.changeset/angular-package-foundation.md`:

```markdown
---
"@viu/emporix-sdk-angular": minor
---

feat(angular): add Angular bindings — provideEmporix, injectEmporixQuery, site and customer-session signals

First release of `@viu/emporix-sdk-angular`. One `provideEmporix()` wires the
SDK, a storage backend and TanStack Query into an Angular application;
`injectEmporixQuery` and `injectEmporixInfinite` run reads with the same cache
keys, auth resolution and `enabled` gating as the React bindings — literally the
same key builder, asserted by test.

**Built with tsup, not ng-packagr.** The package exports only functions
(`inject*`, `provide*`, `InjectionToken`) and contains no decorators, so it needs
no Angular compiler. Two independent guards keep it that way: an ESLint rule on
`Decorator` nodes, and a `check:dist` script that greps the built output for
compiler markers. CI additionally builds an Angular 22 example with
`ng build --configuration production` to prove the artifact survives AOT.

Peers: `@angular/core` and `@angular/common` `>=20.0.0 <23.0.0`,
`@tanstack/angular-query-experimental` `^5.102.0`. ESM only — `@angular/core`
ships no CJS entry and Angular applications always bundle.

**Scope:** 33 of the React package's 107 hooks — catalog, prices, cart,
checkout, customer session and orders, site. `docs/angular.md` names the
excluded 74 by area. Telemetry, customer-token auto-refresh and the B2B company
context are not in this release.

One thing to know before writing your first query: **read signals inside
`injectQuery`'s options callback, not before it.** Read outside, the cache key
and the `enabled` gate freeze at creation time — the symptom is a customer who
logs out and still sees their own orders.
```

- [ ] **Step 8: Full verification**

```bash
pnpm install
pnpm -r --filter "./packages/*" build
pnpm -F @viu/emporix-sdk-angular check:dist
pnpm -F @viu/emporix-sdk-react check:dist
pnpm typecheck
pnpm test
pnpm lint
pnpm -F @viu/emporix-examples-angular exec ng build --configuration production
pnpm changeset status
```

All exit 0. `changeset status` must list `@viu/emporix-sdk-angular` under `minor` and `@viu/emporix-sdk` under `minor` from Task 3.

- [ ] **Step 9: Commit**

```bash
git add packages/angular docs CLAUDE.md README.md examples/README.md .changeset
git commit -m "feat(angular): add the customer session, ssr entry and docs

Completes the foundation. injectCustomerSession ports React's semantics rather
than inventing new ones — including the cart-onboarding step on login, where
getting it wrong silently loses a guest cart.

The ssr entry re-exports TransferState and makeStateKey. Angular SSR has no
tag-based invalidation, so there is no analogue to the next package's cache
tags; hydration is what this entry is for.

docs/angular.md names the excluded 74 injectables by area with counts. A doc
that lists only what exists reads as complete, and the consumer discovers the
gap by failing to import.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Verification of the whole plan

Before opening the PR series:

```bash
pnpm install --frozen-lockfile
pnpm -r --filter "./packages/*" build
pnpm -F @viu/emporix-sdk check:treeshake
pnpm -F @viu/emporix-sdk-react check:dist
pnpm -F @viu/emporix-sdk-angular check:dist
pnpm typecheck
pnpm test
pnpm lint
pnpm -F @viu/emporix-examples-angular exec ng build --configuration production
pnpm changeset status
```

Expected test counts: `packages/angular` at roughly 45 tests across 8 files; `packages/react` at 69 test files plus the new `agnostic-single-source.test.ts`, all passing unchanged.

## Known risks in this plan

- **Task 2 Step 7 can invalidate the plan.** If the AOT production build rejects the tsup artifact, stop. The spec's toolchain decision has to be revisited and Tasks 3–9 change shape. This is why it is Task 2 and not Task 9.
- **Task 1 Step 5 and Task 6 Step 4 both have documented fallbacks** for the Angular test harness. Which branch was taken must be recorded in a code comment, because every later test reuses the same `settle()` helper.
- **Task 9's `injectCustomerSession` is specified less precisely than the other tasks** — deliberately, because its shape comes from `packages/react/src/hooks/use-customer-session.ts` and `bootstrap-cart.ts`, which Step 1 reads. Writing invented signatures here would be worse than pointing at the source of truth.
- **`client.sites.get`'s return shape is assumed** from `packages/react/src/site-context.tsx:95-100` (`currency`, `defaultLanguage`, `languages`, `homeBase.address.country`). If the SDK's `Site` type differs, Task 7's test doubles need updating — the assertion is on the derived signals, not on the DTO, so the fix is local.
