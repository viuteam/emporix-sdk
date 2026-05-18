# Emporix SDK — Plan 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the pnpm monorepo, the `@viu/emporix-sdk` package scaffold, and a fully-tested core (`config`, `errors`, `logger`, `auth` with `TokenProvider`, `http`) — no Emporix service facades yet.

**Architecture:** pnpm workspace monorepo. Core is framework-agnostic, native `fetch` only. `EmporixClient` (built in Plan 2) will compose `config` → `logger` → `TokenProvider` → `http`. This plan delivers those building blocks with the full test matrix from the spec.

**Tech Stack:** TypeScript 5.x (strict, ES2022, `moduleResolution: bundler`), pnpm, tsup, vitest + msw, eslint + prettier (flat config), Changesets, husky + commitlint.

**Spec:** `docs/superpowers/specs/2026-05-17-emporix-sdk-design.md` (sections 3.1–3.3, 4, 5).

---

## File Structure (this plan)

```
pnpm-workspace.yaml                      workspace globs
package.json                             root, private, dev tooling + scripts
tsconfig.base.json                       shared compiler options
.gitignore .npmrc .editorconfig
.changeset/config.json                   changesets config (repo viuteam/emporix-sdk)
commitlint.config.js                     conventional commits
.husky/pre-commit .husky/commit-msg      git hooks
.github/workflows/release.yml            two-PR release
.github/workflows/changeset-check.yml    PR enforcement
packages/sdk/package.json                @viu/emporix-sdk
packages/sdk/tsconfig.json packages/sdk/tsup.config.ts packages/sdk/vitest.config.ts
packages/sdk/eslint.config.js packages/sdk/.prettierrc.json
packages/sdk/src/index.ts                public exports
packages/sdk/src/core/errors.ts          EmporixError hierarchy + fromResponse mapping
packages/sdk/src/core/config.ts          EmporixConfig type + validateConfig
packages/sdk/src/core/logger.ts          LogLevel, LevelResolver, console/noop, redaction
packages/sdk/src/core/auth.ts            AuthContext, auth helper, TokenProvider, resolveToken
packages/sdk/src/core/http.ts            HttpClient (fetch wrapper, retry, 401 asymmetry)
packages/sdk/tests/*.test.ts             one test file per core module
packages/sdk/tests/helpers/memory-logger.ts  MemoryLogger test helper
```

Each core file has one responsibility and is independently unit-tested. `auth.ts` and `http.ts` depend on `errors.ts` + `logger.ts`; nothing depends on a service facade (none exist yet).

---

## Task 1: Root workspace scaffold

**Files:**
- Create: `pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json`, `.gitignore`, `.npmrc`, `.editorconfig`

- [ ] **Step 1: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"
  - "examples/*"
```

- [ ] **Step 2: Create root `package.json`**

```json
{
  "name": "@viu/emporix-sdk-monorepo",
  "private": true,
  "type": "module",
  "engines": { "node": ">=18" },
  "packageManager": "pnpm@10.15.0",
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck",
    "changeset": "changeset",
    "version": "changeset version && pnpm install --lockfile-only",
    "release": "pnpm -r build && changeset publish",
    "prepare": "husky"
  },
  "devDependencies": {
    "@changesets/cli": "^2.27.0",
    "@changesets/changelog-github": "^0.5.0",
    "@commitlint/cli": "^19.0.0",
    "@commitlint/config-conventional": "^19.0.0",
    "husky": "^9.1.0",
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "declaration": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true
  }
}
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
coverage/
*.log
.DS_Store
.env
.env.*
!.env.example
```

- [ ] **Step 5: Create `.npmrc`**

```
auto-install-peers=true
strict-peer-dependencies=false
provenance=true
```

- [ ] **Step 6: Create `.editorconfig`**

```
root = true
[*]
charset = utf-8
indent_style = space
indent_size = 2
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
```

- [ ] **Step 7: Install and commit**

Run: `pnpm install`
Expected: lockfile created, dev deps installed, no errors.

```bash
git add pnpm-workspace.yaml package.json tsconfig.base.json .gitignore .npmrc .editorconfig pnpm-lock.yaml
git commit -m "chore(repo): scaffold pnpm workspace and shared tsconfig"
```

---

## Task 2: Changesets configuration

**Files:**
- Create: `.changeset/config.json`, `.changeset/README.md`

- [ ] **Step 1: Create `.changeset/config.json`**

```json
{
  "$schema": "https://unpkg.com/@changesets/config/schema.json",
  "changelog": ["@changesets/changelog-github", { "repo": "viuteam/emporix-sdk" }],
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": ["@viu/emporix-examples-*"],
  "privatePackages": { "version": false, "tag": false }
}
```

- [ ] **Step 2: Create `.changeset/README.md`**

```md
# Changesets

Run `pnpm changeset` before opening a PR that changes `packages/*/src/**`.
See `CONTRIBUTING.md` for the full workflow. Versions are driven by changesets,
not commit messages.
```

- [ ] **Step 3: Verify changesets recognises the config**

Run: `pnpm changeset status --since=HEAD`
Expected: exits cleanly reporting "No changesets found" (no error about config).

- [ ] **Step 4: Commit**

```bash
git add .changeset
git commit -m "chore(release): configure changesets for viuteam/emporix-sdk"
```

---

## Task 3: Conventional Commits enforcement (commitlint + husky)

**Files:**
- Create: `commitlint.config.js`, `.husky/pre-commit`, `.husky/commit-msg`

- [ ] **Step 1: Create `commitlint.config.js`**

```js
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      2,
      "always",
      ["repo", "release", "sdk", "react", "core", "customer", "product", "category", "cart", "auth", "http", "logger", "deps", "docs", "examples"]
    ]
  }
};
```

- [ ] **Step 2: Initialise husky**

Run: `pnpm exec husky init`
Expected: creates `.husky/` with a sample `pre-commit`. Replace its contents below.

- [ ] **Step 3: Write `.husky/pre-commit`**

```sh
pnpm lint && pnpm typecheck
```

- [ ] **Step 4: Write `.husky/commit-msg`**

```sh
pnpm exec commitlint --edit "$1"
```

- [ ] **Step 5: Make hooks executable and verify commitlint rejects a bad message**

Run: `echo "bad message" | pnpm exec commitlint`
Expected: non-zero exit, complaint about missing type.

- [ ] **Step 6: Commit (proves the hook accepts a good message)**

```bash
chmod +x .husky/pre-commit .husky/commit-msg
git add commitlint.config.js .husky package.json
git commit -m "chore(repo): enforce conventional commits via husky and commitlint"
```
Expected: `pre-commit` runs `pnpm lint && pnpm typecheck` (both succeed: no packages yet so `-r` is a no-op), `commit-msg` passes.

---

## Task 4: GitHub Actions — release + PR enforcement

**Files:**
- Create: `.github/workflows/release.yml`, `.github/workflows/changeset-check.yml`

- [ ] **Step 1: Create `.github/workflows/release.yml`**

```yaml
name: Release
on:
  push:
    branches: [main]
concurrency: ${{ github.workflow }}-${{ github.ref }}
jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      id-token: write
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
          registry-url: https://registry.npmjs.org
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
      - uses: changesets/action@v1
        with:
          publish: pnpm release
          version: pnpm version
          commit: "chore(release): version packages"
          title: "chore(release): version packages"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
          NPM_CONFIG_PROVENANCE: "true"
```

- [ ] **Step 2: Create `.github/workflows/changeset-check.yml`**

```yaml
name: Changeset Check
on: pull_request
jobs:
  check:
    runs-on: ubuntu-latest
    if: ${{ !contains(github.event.pull_request.labels.*.name, 'no-release') }}
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm changeset status --since=origin/${{ github.event.pull_request.base.ref }}
```

- [ ] **Step 3: Lint YAML mentally — verify indentation and that `release.yml` runs typecheck/test/build before the changesets action.**

Expected: both files valid YAML, jobs as described.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows
git commit -m "ci(release): add changesets release and PR enforcement workflows"
```

---

## Task 5: `@viu/emporix-sdk` package scaffold

**Files:**
- Create: `packages/sdk/package.json`, `packages/sdk/tsconfig.json`, `packages/sdk/tsup.config.ts`, `packages/sdk/vitest.config.ts`, `packages/sdk/eslint.config.js`, `packages/sdk/.prettierrc.json`, `packages/sdk/src/index.ts`, `packages/sdk/.env.example`

- [ ] **Step 1: Create `packages/sdk/package.json`**

```json
{
  "name": "@viu/emporix-sdk",
  "version": "0.0.0",
  "description": "TypeScript SDK for the Emporix Commerce Engine",
  "type": "module",
  "sideEffects": false,
  "engines": { "node": ">=18" },
  "files": ["dist", "README.md", "CHANGELOG.md"],
  "exports": {
    ".": { "import": "./dist/index.js", "require": "./dist/index.cjs", "types": "./dist/index.d.ts" }
  },
  "publishConfig": { "access": "public", "provenance": true },
  "scripts": {
    "build": "tsup",
    "test": "vitest run --coverage",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0",
    "@vitest/coverage-v8": "^2.0.0",
    "eslint": "^9.0.0",
    "msw": "^2.4.0",
    "prettier": "^3.3.0",
    "tsup": "^8.2.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `packages/sdk/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist", "types": ["node"] },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Create `packages/sdk/tsup.config.ts`**

```ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
});
```

- [ ] **Step 4: Create `packages/sdk/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/index.ts", "src/generated/**"],
      thresholds: { lines: 80, branches: 80 },
    },
  },
});
```

- [ ] **Step 5: Create `packages/sdk/eslint.config.js`**

```js
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
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
  },
  {
    files: ["src/core/logger.ts"],
    rules: { "no-console": "off" }
  }
];
```

- [ ] **Step 6: Create `packages/sdk/.prettierrc.json`**

```json
{ "semi": true, "singleQuote": false, "trailingComma": "all", "printWidth": 100 }
```

- [ ] **Step 7: Create `packages/sdk/.env.example`**

```
EMPORIX_TENANT=mytenant
EMPORIX_BACKEND_CLIENT_ID=
EMPORIX_BACKEND_CLIENT_SECRET=
EMPORIX_STOREFRONT_CLIENT_ID=
```

- [ ] **Step 8: Create placeholder `packages/sdk/src/index.ts`**

```ts
// Public exports are populated as core modules land (final task of this plan).
export {};
```

- [ ] **Step 9: Install, typecheck, lint, build**

Run: `pnpm install`
Run: `pnpm --filter @viu/emporix-sdk typecheck`
Expected: PASS (empty module).
Run: `pnpm --filter @viu/emporix-sdk lint`
Expected: PASS.
Run: `pnpm --filter @viu/emporix-sdk build`
Expected: `dist/index.js`, `dist/index.cjs`, `dist/index.d.ts` produced.

- [ ] **Step 10: Commit**

```bash
git add packages/sdk pnpm-lock.yaml
git commit -m "chore(sdk): scaffold @viu/emporix-sdk package (tsup, vitest, eslint)"
```

---

## Task 6: `errors.ts` — error hierarchy

**Files:**
- Create: `packages/sdk/src/core/errors.ts`
- Test: `packages/sdk/tests/errors.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import {
  EmporixError, EmporixAuthError, EmporixForbiddenError, EmporixNotFoundError,
  EmporixValidationError, EmporixServerError, errorFromResponse,
} from "../src/core/errors";

describe("errors", () => {
  it("all subclasses extend EmporixError and carry status", () => {
    const e = new EmporixAuthError("nope", 401, { foo: "bar" });
    expect(e).toBeInstanceOf(EmporixError);
    expect(e.status).toBe(401);
    expect(e.body).toEqual({ foo: "bar" });
    expect(e.name).toBe("EmporixAuthError");
  });

  it("errorFromResponse maps status codes to subclasses", () => {
    expect(errorFromResponse(401, "a", {})).toBeInstanceOf(EmporixAuthError);
    expect(errorFromResponse(403, "a", {})).toBeInstanceOf(EmporixForbiddenError);
    expect(errorFromResponse(404, "a", {})).toBeInstanceOf(EmporixNotFoundError);
    expect(errorFromResponse(400, "a", {})).toBeInstanceOf(EmporixValidationError);
    expect(errorFromResponse(422, "a", {})).toBeInstanceOf(EmporixValidationError);
    expect(errorFromResponse(500, "a", {})).toBeInstanceOf(EmporixServerError);
    expect(errorFromResponse(418, "a", {})).toBeInstanceOf(EmporixError);
  });

  it("never serialises token-like fields in body via toJSON", () => {
    const e = new EmporixAuthError("x", 401, { access_token: "SECRET", ok: 1 });
    expect(JSON.stringify(e)).not.toContain("SECRET");
    expect(JSON.stringify(e)).toContain('"ok":1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/errors.test.ts`
Expected: FAIL — cannot resolve `../src/core/errors`.

- [ ] **Step 3: Write minimal implementation**

```ts
/** Keys whose values are stripped from any serialised error body. */
const REDACTED_BODY_KEYS = new Set([
  "access_token", "refresh_token", "token", "customertoken", "saastoken",
  "secret", "client_secret", "authorization", "password",
]);

function scrub(body: unknown): unknown {
  if (Array.isArray(body)) return body.map(scrub);
  if (body && typeof body === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      out[k] = REDACTED_BODY_KEYS.has(k.toLowerCase()) ? "***redacted***" : scrub(v);
    }
    return out;
  }
  return body;
}

/** Base class for every error thrown by the SDK. */
export class EmporixError extends Error {
  readonly status: number | undefined;
  readonly body: unknown;
  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.body = body;
    Object.setPrototypeOf(this, new.target.prototype);
  }
  /** Safe serialisation — token-like body fields are redacted. */
  toJSON(): Record<string, unknown> {
    return { name: this.name, message: this.message, status: this.status, body: scrub(this.body) };
  }
}

/** 401 — authentication failed or token expired. */
export class EmporixAuthError extends EmporixError {}
/** 403 — authenticated but not permitted. */
export class EmporixForbiddenError extends EmporixError {}
/** 404 — resource not found. */
export class EmporixNotFoundError extends EmporixError {}
/** 400/422 — request validation failed. */
export class EmporixValidationError extends EmporixError {}
/** 5xx — server-side failure. */
export class EmporixServerError extends EmporixError {}

/** Maps an HTTP status to the matching {@link EmporixError} subclass. */
export function errorFromResponse(status: number, message: string, body: unknown): EmporixError {
  if (status === 401) return new EmporixAuthError(message, status, body);
  if (status === 403) return new EmporixForbiddenError(message, status, body);
  if (status === 404) return new EmporixNotFoundError(message, status, body);
  if (status === 400 || status === 422) return new EmporixValidationError(message, status, body);
  if (status >= 500) return new EmporixServerError(message, status, body);
  return new EmporixError(message, status, body);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/errors.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/core/errors.ts packages/sdk/tests/errors.test.ts
git commit -m "feat(core): add EmporixError hierarchy with redacted serialisation"
```

---

## Task 7: `config.ts` — config type + validation

**Files:**
- Create: `packages/sdk/src/core/config.ts`
- Test: `packages/sdk/tests/config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { validateConfig, DEFAULT_HOST } from "../src/core/config";

const creds = { backend: { clientId: "b", secret: "s" } };

describe("validateConfig", () => {
  it("accepts a minimal valid config and fills defaults", () => {
    const c = validateConfig({ tenant: "acme", credentials: creds });
    expect(c.host).toBe(DEFAULT_HOST);
    expect(c.cache.expirationBufferSeconds).toBe(60);
    expect(c.cache.maxLifetimeSeconds).toBe(3600);
    expect(c.retry.maxAttempts).toBe(3);
  });

  it.each(["AB", "ab", "1abc", "a_b", "thisnameiswaytoolongxx", "Acme"])(
    "rejects invalid tenant %s",
    (tenant) => {
      expect(() => validateConfig({ tenant, credentials: creds })).toThrow(/tenant/i);
    },
  );

  it("accepts boundary-valid tenants", () => {
    expect(validateConfig({ tenant: "abc", credentials: creds }).tenant).toBe("abc");
    expect(validateConfig({ tenant: "ab1cd2ef3gh4ij5x", credentials: creds }).tenant).toBe(
      "ab1cd2ef3gh4ij5x",
    );
  });

  it("requires credentials.backend", () => {
    // @ts-expect-error intentionally missing backend
    expect(() => validateConfig({ tenant: "acme", credentials: {} })).toThrow(/backend/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/config.test.ts`
Expected: FAIL — cannot resolve `../src/core/config`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { LoggerConfig } from "./logger";
import type { TokenProvider } from "./auth";

/** Default Emporix API host. */
export const DEFAULT_HOST = "https://api.emporix.io";

/**
 * Tenant guard. Emporix docs only state "always lowercase"; the 3–16 char
 * `^[a-z][a-z0-9]+$` rule is an SDK-side guard, not a documented constraint.
 */
const TENANT_RE = /^[a-z][a-z0-9]{2,15}$/;

/** A client-credentials credential set (service / custom). */
export interface ServiceCredentials {
  clientId: string;
  secret: string;
  scope?: string;
}

/** Storefront credential — anonymous token needs the client id only, no secret. */
export interface StorefrontCredentials {
  clientId: string;
}

/** User-supplied SDK configuration. */
export interface EmporixConfig {
  tenant: string;
  host?: string;
  credentials: {
    backend: ServiceCredentials;
    storefront?: StorefrontCredentials;
    custom?: Record<string, ServiceCredentials>;
  };
  tokenProvider?: TokenProvider;
  timeouts?: { connectMs?: number; readMs?: number };
  retry?: { maxAttempts?: number };
  cache?: { expirationBufferSeconds?: number; maxLifetimeSeconds?: number };
  logger?: LoggerConfig;
}

/** Fully-resolved configuration with defaults applied. */
export interface ResolvedConfig {
  tenant: string;
  host: string;
  credentials: EmporixConfig["credentials"];
  tokenProvider: TokenProvider | undefined;
  timeouts: { connectMs: number; readMs: number };
  retry: { maxAttempts: number };
  cache: { expirationBufferSeconds: number; maxLifetimeSeconds: number };
  logger: LoggerConfig | undefined;
}

/** Validates user config and applies defaults. Throws on invalid tenant/credentials. */
export function validateConfig(input: EmporixConfig): ResolvedConfig {
  if (!TENANT_RE.test(input.tenant)) {
    throw new Error(
      `Invalid tenant "${input.tenant}": must be lowercase, 3–16 chars, match ^[a-z][a-z0-9]+$`,
    );
  }
  if (!input.credentials?.backend?.clientId || !input.credentials.backend.secret) {
    throw new Error("credentials.backend.clientId and credentials.backend.secret are required");
  }
  return {
    tenant: input.tenant,
    host: input.host ?? DEFAULT_HOST,
    credentials: input.credentials,
    tokenProvider: input.tokenProvider,
    timeouts: {
      connectMs: input.timeouts?.connectMs ?? 10_000,
      readMs: input.timeouts?.readMs ?? 60_000,
    },
    retry: { maxAttempts: input.retry?.maxAttempts ?? 3 },
    cache: {
      expirationBufferSeconds: input.cache?.expirationBufferSeconds ?? 60,
      maxLifetimeSeconds: input.cache?.maxLifetimeSeconds ?? 3600,
    },
    logger: input.logger,
  };
}
```

> Note: `LoggerConfig` (Task 8/9) and `TokenProvider` (Task 11) are type-only
> imports. They are referenced before they exist; create empty stubs only if
> `tsc` blocks you, then remove the stubs once those tasks land. Tests in this
> task do not exercise those types.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/config.test.ts`
Expected: PASS. (If `tsc` complains about missing `./logger`/`./auth` type
imports, proceed — vitest transpiles per-file; full typecheck runs in Task 15.)

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/core/config.ts packages/sdk/tests/config.test.ts
git commit -m "feat(core): add EmporixConfig type and validateConfig with tenant guard"
```

---

## Task 8: `logger.ts` — LogLevel + LevelResolver

**Files:**
- Create: `packages/sdk/src/core/logger.ts`
- Test: `packages/sdk/tests/logger-resolver.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { LevelResolver, LEVEL } from "../src/core/logger";

const ENV = ["EMPORIX_LOG_LEVEL", "EMPORIX_LOG_LEVEL_CART", "EMPORIX_LOG_LEVEL_HTTP"];

describe("LevelResolver", () => {
  beforeEach(() => ENV.forEach((k) => delete process.env[k]));
  afterEach(() => ENV.forEach((k) => delete process.env[k]));

  it("defaults to warn with no config or env", () => {
    const r = new LevelResolver({});
    expect(r.get("cart")).toBe("warn");
    expect(r.numericLevel("cart")).toBe(LEVEL.warn);
  });

  it("config.level is the floor; per-service overrides it", () => {
    const r = new LevelResolver({ level: "info", services: { cart: "trace" } });
    expect(r.get("http")).toBe("info");
    expect(r.get("cart")).toBe("trace");
  });

  it("env per-service beats env global beats config", () => {
    process.env.EMPORIX_LOG_LEVEL = "error";
    process.env.EMPORIX_LOG_LEVEL_CART = "trace";
    const r = new LevelResolver({ level: "info", services: { cart: "debug", http: "debug" } });
    expect(r.get("cart")).toBe("trace"); // env per-service
    expect(r.get("http")).toBe("error"); // env global beats config
  });

  it("invalid env value is ignored with one warn", () => {
    process.env.EMPORIX_LOG_LEVEL_CART = "loud";
    const warns: string[] = [];
    const r = new LevelResolver({}, (m) => warns.push(m));
    expect(r.get("cart")).toBe("warn");
    expect(warns).toHaveLength(1);
  });

  it("runtime mutation propagates; env-set levels are sticky unless forced", () => {
    process.env.EMPORIX_LOG_LEVEL_CART = "trace";
    const r = new LevelResolver({ level: "warn" });
    r.set("debug");
    expect(r.get("http")).toBe("debug");
    r.set("error", "cart");
    expect(r.get("cart")).toBe("trace"); // sticky env
    r.set("error", "cart", true);
    expect(r.get("cart")).toBe("error"); // forced
  });

  it("isAtLeast compares numerically", () => {
    const r = new LevelResolver({ level: "info" });
    expect(r.isAtLeast("http", "warn")).toBe(true);
    expect(r.isAtLeast("http", "debug")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/logger-resolver.test.ts`
Expected: FAIL — cannot resolve `../src/core/logger`.

- [ ] **Step 3: Write minimal implementation (resolver + types only)**

```ts
/** Log severity, low → high. */
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "silent";

/** Numeric ordering used for fast comparison. */
export const LEVEL: Record<LogLevel, number> = {
  trace: 10, debug: 20, info: 30, warn: 40, error: 50, silent: 60,
};

/** Services that bind their own logger and are independently level-controllable. */
export type ServiceName = "customer" | "product" | "category" | "cart" | "http" | "auth";

/** Arbitrary structured fields attached to a log line. */
export interface LogFields { [key: string]: unknown; }

/** The logger contract consumers may implement or swap. */
export interface Logger {
  level: LogLevel;
  isLevelEnabled(level: LogLevel): boolean;
  trace(msg: string, fields?: LogFields): void;
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

/** Object form of logger configuration. */
export interface LoggerObjectConfig {
  level?: LogLevel;
  services?: Partial<Record<ServiceName, LogLevel>>;
  pretty?: boolean;
  redact?: string[];
}

/** `false` → noop logger; `Logger` → user-supplied; object → built-in console logger. */
export type LoggerConfig = false | Logger | LoggerObjectConfig;

function isValidLevel(v: string | undefined): v is LogLevel {
  return v !== undefined && v in LEVEL;
}

/**
 * Resolves the effective level per service following:
 * env per-service > env global > config.services[svc] > config.level > "warn".
 * Runtime `set()` mutates programmatic levels but never overrides env-set ones
 * unless `force` is passed.
 */
export class LevelResolver {
  private cfgLevel: LogLevel;
  private cfgServices: Partial<Record<ServiceName, LogLevel>>;
  private warned = false;

  constructor(
    cfg: LoggerObjectConfig,
    private readonly warn: (msg: string) => void = () => {},
  ) {
    this.cfgLevel = cfg.level ?? "warn";
    this.cfgServices = { ...cfg.services };
  }

  private envFor(svc: ServiceName): LogLevel | undefined {
    const raw = process.env[`EMPORIX_LOG_LEVEL_${svc.toUpperCase()}`];
    if (raw === undefined) return undefined;
    if (isValidLevel(raw)) return raw;
    if (!this.warned) { this.warned = true; this.warn(`Invalid EMPORIX_LOG_LEVEL_${svc.toUpperCase()}="${raw}" ignored`); }
    return undefined;
  }

  private envGlobal(): LogLevel | undefined {
    const raw = process.env.EMPORIX_LOG_LEVEL;
    if (raw === undefined) return undefined;
    if (isValidLevel(raw)) return raw;
    if (!this.warned) { this.warned = true; this.warn(`Invalid EMPORIX_LOG_LEVEL="${raw}" ignored`); }
    return undefined;
  }

  /** Effective level for a service. */
  get(svc: ServiceName): LogLevel {
    return this.envFor(svc) ?? this.envGlobal() ?? this.cfgServices[svc] ?? this.cfgLevel ?? "warn";
  }

  /** Numeric effective level for a service. */
  numericLevel(svc: ServiceName): number {
    return LEVEL[this.get(svc)];
  }

  /** True if `svc`'s effective level allows emitting at `at`. */
  isAtLeast(svc: ServiceName, at: LogLevel): boolean {
    return this.numericLevel(svc) <= LEVEL[at];
  }

  /** Mutates programmatic level (global or one service). Env-set levels are sticky unless `force`. */
  set(level: LogLevel, svc?: ServiceName, force = false): void {
    if (svc) {
      const envBound = process.env[`EMPORIX_LOG_LEVEL_${svc.toUpperCase()}`] !== undefined;
      if (envBound && !force) { this.warn(`Level for "${svc}" is env-controlled; pass force to override`); return; }
      this.cfgServices[svc] = level;
    } else {
      this.cfgLevel = level;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/logger-resolver.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/core/logger.ts packages/sdk/tests/logger-resolver.test.ts
git commit -m "feat(logger): add LogLevel, Logger interface and per-service LevelResolver"
```

---

## Task 9: `logger.ts` — console/noop loggers + redaction + MemoryLogger

**Files:**
- Modify: `packages/sdk/src/core/logger.ts` (append)
- Create: `packages/sdk/tests/helpers/memory-logger.ts`
- Test: `packages/sdk/tests/logger-emit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { LevelResolver, createConsoleLogger, createNoopLogger, redact } from "../src/core/logger";
import { MemoryLogger } from "./helpers/memory-logger";

describe("redact", () => {
  it("redacts default keys case-insensitively, deep, in arrays", () => {
    const out = redact({
      Authorization: "Bearer abc",
      nested: { password: "p", items: [{ access_token: "T" }] },
      keep: 1,
    });
    expect(out).toEqual({
      Authorization: "Bearer ***redacted***",
      nested: { password: "***redacted***", items: [{ access_token: "***redacted***" }] },
      keep: 1,
    });
  });

  it("strips token from an AuthContext, keeping kind", () => {
    expect(redact({ kind: "customer", token: "SECRET" })).toEqual({ kind: "customer" });
  });

  it("honours extra redact keys but never drops the default floor", () => {
    const out = redact({ customField: "x", token: "y" }, ["customField"]);
    expect(out).toEqual({ customField: "***redacted***", token: "***redacted***" });
  });
});

describe("loggers", () => {
  it("noop logger never emits and reports silent", () => {
    const l = createNoopLogger();
    expect(l.level).toBe("silent");
    expect(l.isLevelEnabled("error")).toBe(false);
    l.error("boom"); // no throw
  });

  it("console logger respects resolver level and child bindings", () => {
    const r = new LevelResolver({ level: "warn" });
    const mem = new MemoryLogger(r, { service: "cart" });
    const child = mem.child({ requestId: "r1" });
    child.debug("hidden");
    child.warn("shown", { token: "SECRET" });
    expect(mem.entries.map((e) => e.msg)).toEqual(["shown"]);
    expect(mem.entries[0]?.fields).toEqual({ requestId: "r1", token: "***redacted***" });
    expect(mem.entries[0]?.service).toBe("cart");
  });

  it("createConsoleLogger emits via console without leaking secrets", () => {
    const r = new LevelResolver({ level: "info" });
    const lines: unknown[][] = [];
    const spy = (...a: unknown[]) => lines.push(a);
    const l = createConsoleLogger(r, { service: "auth" }, { sink: { info: spy, warn: spy, error: spy, log: spy } });
    l.info("authenticated", { access_token: "SECRET" });
    expect(JSON.stringify(lines)).not.toContain("SECRET");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/logger-emit.test.ts`
Expected: FAIL — `createConsoleLogger`/`redact`/`MemoryLogger` not exported.

- [ ] **Step 3: Append implementation to `logger.ts`**

```ts
import type { ServiceName as _Svc } from "./logger";

/** Default redaction floor — never reducible. */
const DEFAULT_REDACT = new Set([
  "authorization", "password", "oldpassword", "newpassword", "clientsecret",
  "secret", "access_token", "refresh_token", "customertoken", "saastoken",
  "bearertoken", "apikey", "token",
]);

/** Deep-clones `value`, replacing redacted keys with a mask. AuthContext token is stripped. */
export function redact(value: unknown, extra: string[] = []): unknown {
  const keys = new Set(DEFAULT_REDACT);
  for (const k of extra) keys.add(k.toLowerCase());
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const src = v as Record<string, unknown>;
      // AuthContext: keep only `kind`.
      if (typeof src.kind === "string" && "token" in src) return { kind: src.kind };
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(src)) {
        if (keys.has(k.toLowerCase())) {
          out[k] = k.toLowerCase() === "authorization" && typeof val === "string"
            ? "Bearer ***redacted***"
            : "***redacted***";
        } else {
          out[k] = walk(val);
        }
      }
      return out;
    }
    return v;
  };
  return walk(value);
}

type Sink = { log: (...a: unknown[]) => void; info: (...a: unknown[]) => void;
  warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };

const EMIT: Record<Exclude<LogLevel, "silent">, number> = {
  trace: LEVEL.trace, debug: LEVEL.debug, info: LEVEL.info, warn: LEVEL.warn, error: LEVEL.error,
};

abstract class BaseLogger implements Logger {
  constructor(
    protected readonly resolver: LevelResolver,
    protected readonly bindings: LogFields,
    protected readonly extraRedact: string[],
  ) {}
  private svc(): _Svc {
    return (this.bindings.service as _Svc) ?? "http";
  }
  get level(): LogLevel { return this.resolver.get(this.svc()); }
  isLevelEnabled(level: LogLevel): boolean { return this.resolver.isAtLeast(this.svc(), level); }
  protected abstract emit(level: Exclude<LogLevel, "silent">, msg: string, fields: LogFields): void;
  private at(level: Exclude<LogLevel, "silent">, msg: string, fields?: LogFields): void {
    if (this.resolver.numericLevel(this.svc()) > EMIT[level]) return;
    const merged = { ...this.bindings, ...(fields ?? {}) };
    this.emit(level, msg, redact(merged, this.extraRedact) as LogFields);
  }
  trace(m: string, f?: LogFields): void { this.at("trace", m, f); }
  debug(m: string, f?: LogFields): void { this.at("debug", m, f); }
  info(m: string, f?: LogFields): void { this.at("info", m, f); }
  warn(m: string, f?: LogFields): void { this.at("warn", m, f); }
  error(m: string, f?: LogFields): void { this.at("error", m, f); }
  abstract child(bindings: LogFields): Logger;
}

class ConsoleLogger extends BaseLogger {
  constructor(
    resolver: LevelResolver, bindings: LogFields, extra: string[],
    private readonly sink: Sink, private readonly pretty: boolean,
  ) { super(resolver, bindings, extra); }
  protected emit(level: Exclude<LogLevel, "silent">, msg: string, fields: LogFields): void {
    if (this.pretty) {
      const fn = level === "error" ? this.sink.error : level === "warn" ? this.sink.warn
        : level === "info" ? this.sink.info : this.sink.log;
      fn(`[${level}] ${msg}`, fields);
    } else {
      this.sink.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }));
    }
  }
  child(bindings: LogFields): Logger {
    return new ConsoleLogger(
      this.resolver, { ...this.bindings, ...bindings }, this.extraRedact, this.sink, this.pretty,
    );
  }
}

class NoopLogger implements Logger {
  level: LogLevel = "silent";
  isLevelEnabled(): boolean { return false; }
  trace(): void {} debug(): void {} info(): void {} warn(): void {} error(): void {}
  child(): Logger { return this; }
}

/** Creates the built-in console logger. `opts.sink` overrides `console` (used in tests). */
export function createConsoleLogger(
  resolver: LevelResolver,
  bindings: LogFields = {},
  opts: { pretty?: boolean; redact?: string[]; sink?: Sink } = {},
): Logger {
  const pretty = opts.pretty ?? process.env.NODE_ENV !== "production";
  /* eslint-disable no-console */
  const sink: Sink = opts.sink ?? {
    log: console.log, info: console.info, warn: console.warn, error: console.error,
  };
  /* eslint-enable no-console */
  return new ConsoleLogger(resolver, bindings, opts.redact ?? [], sink, pretty);
}

/** Creates a logger that discards everything. */
export function createNoopLogger(): Logger { return new NoopLogger(); }
```

- [ ] **Step 4: Create `packages/sdk/tests/helpers/memory-logger.ts`**

```ts
import { type Logger, type LogFields, type LogLevel, type LevelResolver, redact }
  from "../../src/core/logger";

export interface MemoryEntry {
  level: LogLevel;
  msg: string;
  service: string | undefined;
  fields: LogFields;
}

/** Test logger capturing emitted entries; honours the resolver and redaction. */
export class MemoryLogger implements Logger {
  readonly entries: MemoryEntry[];
  constructor(
    private readonly resolver: LevelResolver,
    private readonly bindings: LogFields = {},
    entries: MemoryEntry[] = [],
  ) { this.entries = entries; }
  private svc() { return (this.bindings.service as never) ?? "http"; }
  get level(): LogLevel { return this.resolver.get(this.svc()); }
  isLevelEnabled(l: LogLevel): boolean { return this.resolver.isAtLeast(this.svc(), l); }
  private at(level: LogLevel, msg: string, fields?: LogFields) {
    if (!this.isLevelEnabled(level)) return;
    const merged = { ...this.bindings, ...(fields ?? {}) };
    this.entries.push({
      level, msg,
      service: this.bindings.service as string | undefined,
      fields: redact(merged) as LogFields,
    });
  }
  trace(m: string, f?: LogFields) { this.at("trace", m, f); }
  debug(m: string, f?: LogFields) { this.at("debug", m, f); }
  info(m: string, f?: LogFields) { this.at("info", m, f); }
  warn(m: string, f?: LogFields) { this.at("warn", m, f); }
  error(m: string, f?: LogFields) { this.at("error", m, f); }
  child(bindings: LogFields): Logger {
    return new MemoryLogger(this.resolver, { ...this.bindings, ...bindings }, this.entries);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/logger-emit.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/core/logger.ts packages/sdk/tests/logger-emit.test.ts packages/sdk/tests/helpers/memory-logger.ts
git commit -m "feat(logger): add console/noop loggers, redaction and MemoryLogger helper"
```

---

## Task 10: `auth.ts` — AuthContext, `auth` helper, resolveToken (no provider yet)

**Files:**
- Create: `packages/sdk/src/core/auth.ts`
- Test: `packages/sdk/tests/auth-context.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { auth, resolveToken, type TokenProvider } from "../src/core/auth";

const fakeProvider: TokenProvider = {
  getToken: async (set) => `svc:${set}`,
  getAnonymousToken: async () => ({
    accessToken: "anon", refreshToken: "r", sessionId: "s", expiresIn: 3599,
  }),
};

describe("auth helper", () => {
  it("builds each AuthContext kind", () => {
    expect(auth.service()).toEqual({ kind: "service" });
    expect(auth.service("partner")).toEqual({ kind: "service", credentials: "partner" });
    expect(auth.anonymous()).toEqual({ kind: "anonymous" });
    expect(auth.customer("c")).toEqual({ kind: "customer", token: "c" });
    expect(auth.raw("x")).toEqual({ kind: "raw", token: "x" });
  });
});

describe("resolveToken", () => {
  it("service resolves via provider with default 'backend'", async () => {
    expect(await resolveToken({ kind: "service" }, fakeProvider)).toBe("svc:backend");
    expect(await resolveToken({ kind: "service", credentials: "partner" }, fakeProvider))
      .toBe("svc:partner");
  });
  it("anonymous resolves via provider's anonymous token", async () => {
    expect(await resolveToken({ kind: "anonymous" }, fakeProvider)).toBe("anon");
  });
  it("customer and raw pass through verbatim", async () => {
    expect(await resolveToken({ kind: "customer", token: "C" }, fakeProvider)).toBe("C");
    expect(await resolveToken({ kind: "raw", token: "R" }, fakeProvider)).toBe("R");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/auth-context.test.ts`
Expected: FAIL — cannot resolve `../src/core/auth`.

- [ ] **Step 3: Write minimal implementation**

```ts
/** Which token a call should use. */
export type AuthKind = "service" | "customer" | "anonymous" | "raw";

/** Caller-supplied, per-call auth selector. Never stored on the client. */
export type AuthContext =
  | { kind: "service"; credentials?: string }
  | { kind: "anonymous" }
  | { kind: "customer"; token: string }
  | { kind: "raw"; token: string };

/** An obtained anonymous storefront session. */
export interface AnonymousSession {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  expiresIn: number;
}

/** Supplies SDK-managed tokens (service/custom + anonymous). May be user-injected. */
export interface TokenProvider {
  /** Service/custom client-credentials token for the named credential set. */
  getToken(credentialSet: string): Promise<string>;
  /** Cached anonymous storefront session (preserves sessionId across refreshes). */
  getAnonymousToken(): Promise<AnonymousSession>;
  /** Invalidate a cached SDK-managed token so the next call re-auths. */
  invalidate?(credentialSet: string): void;
  /** Invalidate the cached anonymous session. */
  invalidateAnonymous?(): void;
}

/** Tiny constructors for {@link AuthContext}. */
export const auth = {
  /** Service/custom credential set (default `backend`). */
  service: (credentials?: string): AuthContext =>
    credentials === undefined ? { kind: "service" } : { kind: "service", credentials },
  /** Cached anonymous storefront token. */
  anonymous: (): AuthContext => ({ kind: "anonymous" }),
  /** Caller-owned customer bearer token. */
  customer: (token: string): AuthContext => ({ kind: "customer", token }),
  /** Exact token, no transformation (SSO / token-exchange). */
  raw: (token: string): AuthContext => ({ kind: "raw", token }),
};

/** Resolves an {@link AuthContext} to a concrete bearer token. */
export async function resolveToken(ctx: AuthContext, provider: TokenProvider): Promise<string> {
  switch (ctx.kind) {
    case "service":
      return provider.getToken(ctx.credentials ?? "backend");
    case "anonymous":
      return (await provider.getAnonymousToken()).accessToken;
    case "customer":
    case "raw":
      return ctx.token;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/auth-context.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/core/auth.ts packages/sdk/tests/auth-context.test.ts
git commit -m "feat(auth): add AuthContext, auth helper and resolveToken"
```

---

## Task 11: `auth.ts` — `DefaultTokenProvider` service/custom path

**Files:**
- Modify: `packages/sdk/src/core/auth.ts` (append)
- Test: `packages/sdk/tests/token-provider-service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { DefaultTokenProvider } from "../src/core/auth";
import { EmporixAuthError } from "../src/core/errors";

let hits = 0;
const server = setupServer(
  http.post("https://api.emporix.io/oauth/token", async ({ request }) => {
    const body = new URLSearchParams(await request.text());
    if (body.get("client_secret") === "bad") {
      return HttpResponse.json({ error: "invalid_client" }, { status: 401 });
    }
    hits += 1;
    return HttpResponse.json({
      access_token: `tok-${body.get("client_id")}-${hits}`,
      token_type: "Bearer",
      expires_in: 3600,
    });
  }),
);
beforeAll(() => server.listen());
afterEach(() => { server.resetHandlers(); hits = 0; });
afterAll(() => server.close());

const cfg = {
  host: "https://api.emporix.io",
  credentials: {
    backend: { clientId: "b", secret: "s" },
    custom: { partner: { clientId: "p", secret: "s", scope: "x" } },
  },
  cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
};

describe("DefaultTokenProvider service path", () => {
  it("fetches, caches per credential set, and reuses within TTL", async () => {
    const p = new DefaultTokenProvider(cfg as never);
    const a = await p.getToken("backend");
    const b = await p.getToken("backend");
    expect(a).toBe("tok-b-1");
    expect(b).toBe("tok-b-1"); // cached, no second hit
    expect(await p.getToken("partner")).toBe("tok-p-2");
  });

  it("concurrent calls share a single in-flight request", async () => {
    const p = new DefaultTokenProvider(cfg as never);
    const [x, y] = await Promise.all([p.getToken("backend"), p.getToken("backend")]);
    expect(x).toBe(y);
    expect(hits).toBe(1);
  });

  it("invalidate forces a refetch", async () => {
    const p = new DefaultTokenProvider(cfg as never);
    await p.getToken("backend");
    p.invalidate("backend");
    expect(await p.getToken("backend")).toBe("tok-b-2");
  });

  it("throws EmporixAuthError on 4xx", async () => {
    const bad = { ...cfg, credentials: { backend: { clientId: "b", secret: "bad" } } };
    const p = new DefaultTokenProvider(bad as never);
    await expect(p.getToken("backend")).rejects.toBeInstanceOf(EmporixAuthError);
  });

  it("throws for an unknown credential set", async () => {
    const p = new DefaultTokenProvider(cfg as never);
    await expect(p.getToken("nope")).rejects.toThrow(/credential set/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/token-provider-service.test.ts`
Expected: FAIL — `DefaultTokenProvider` not exported.

- [ ] **Step 3: Append implementation to `auth.ts`**

```ts
import type { ResolvedConfig, ServiceCredentials } from "./config";
import { EmporixAuthError } from "./errors";

interface CacheEntry { token: string; expiresAt: number; obtainedAt: number; }

/** SDK-owned token provider: client-credentials service tokens + anonymous session. */
export class DefaultTokenProvider implements TokenProvider {
  private readonly serviceCache = new Map<string, CacheEntry>();
  private readonly serviceLocks = new Map<string, Promise<string>>();
  private anon: (AnonymousSession & { expiresAt: number }) | undefined;
  private anonLock: Promise<AnonymousSession> | undefined;

  constructor(private readonly cfg: ResolvedConfig) {}

  private creds(set: string): ServiceCredentials {
    if (set === "backend") return this.cfg.credentials.backend;
    const c = this.cfg.credentials.custom?.[set];
    if (!c) throw new Error(`Unknown credential set "${set}"`);
    return c;
  }

  private fresh(e: CacheEntry | undefined): boolean {
    if (!e) return false;
    const now = Date.now();
    if (now - e.obtainedAt >= this.cfg.cache.maxLifetimeSeconds * 1000) return false;
    return now < e.expiresAt;
  }

  async getToken(set: string): Promise<string> {
    const cached = this.serviceCache.get(set);
    if (this.fresh(cached)) return cached!.token;
    const inflight = this.serviceLocks.get(set);
    if (inflight) return inflight;
    const p = this.requestServiceToken(set).finally(() => this.serviceLocks.delete(set));
    this.serviceLocks.set(set, p);
    return p;
  }

  private async requestServiceToken(set: string): Promise<string> {
    const c = this.creds(set);
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: c.clientId,
      client_secret: c.secret,
    });
    if (c.scope) body.set("scope", c.scope);
    const res = await fetch(`${this.cfg.host}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new EmporixAuthError(`Token request failed for "${set}"`, res.status, json);
    }
    const obtainedAt = Date.now();
    const ttl = Number((json as { expires_in?: number }).expires_in ?? 3600);
    this.serviceCache.set(set, {
      token: (json as { access_token: string }).access_token,
      obtainedAt,
      expiresAt: obtainedAt + (ttl - this.cfg.cache.expirationBufferSeconds) * 1000,
    });
    return this.serviceCache.get(set)!.token;
  }

  invalidate(set: string): void { this.serviceCache.delete(set); }

  // Anonymous path is implemented in the next task.
  async getAnonymousToken(): Promise<AnonymousSession> {
    throw new Error("not implemented yet");
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/token-provider-service.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/core/auth.ts packages/sdk/tests/token-provider-service.test.ts
git commit -m "feat(auth): add DefaultTokenProvider service/custom token path with caching"
```

---

## Task 12: `auth.ts` — anonymous token path (fetch + cache + refresh preserving sessionId)

**Files:**
- Modify: `packages/sdk/src/core/auth.ts` (replace the placeholder `getAnonymousToken`, add refresh + invalidate)
- Test: `packages/sdk/tests/token-provider-anon.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { DefaultTokenProvider } from "../src/core/auth";

let loginHits = 0;
let refreshHits = 0;
const SESSION = "sess-123";
const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", ({ request }) => {
    const u = new URL(request.url);
    expect(u.searchParams.get("tenant")).toBe("acme");
    expect(u.searchParams.get("client_id")).toBe("sf");
    loginHits += 1;
    return HttpResponse.json({
      access_token: `anon-${loginHits}`, token_type: "Bearer",
      expires_in: 3599, refresh_token: "rt-1", sessionId: SESSION, scope: "tenant=acme",
    });
  }),
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/refresh", ({ request }) => {
    const u = new URL(request.url);
    expect(u.searchParams.get("refresh_token")).toBe("rt-1");
    refreshHits += 1;
    return HttpResponse.json({
      access_token: `anon-r${refreshHits}`, token_type: "Bearer",
      expires_in: 3599, refresh_token: "rt-1", sessionId: SESSION, scope: "tenant=acme",
    });
  }),
);
beforeAll(() => server.listen());
afterEach(() => { server.resetHandlers(); loginHits = 0; refreshHits = 0; });
afterAll(() => server.close());

const cfg = {
  tenant: "acme",
  host: "https://api.emporix.io",
  credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
  cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
};

describe("DefaultTokenProvider anonymous path", () => {
  it("fetches an anonymous session and caches it", async () => {
    const p = new DefaultTokenProvider(cfg as never);
    const s1 = await p.getAnonymousToken();
    const s2 = await p.getAnonymousToken();
    expect(s1.accessToken).toBe("anon-1");
    expect(s2.accessToken).toBe("anon-1"); // cached
    expect(s1.sessionId).toBe(SESSION);
    expect(loginHits).toBe(1);
  });

  it("refresh preserves the same sessionId", async () => {
    const p = new DefaultTokenProvider(cfg as never);
    await p.getAnonymousToken();
    const refreshed = await p.refreshAnonymous();
    expect(refreshed.accessToken).toBe("anon-r1");
    expect(refreshed.sessionId).toBe(SESSION);
    expect(refreshHits).toBe(1);
  });

  it("invalidateAnonymous forces a fresh login", async () => {
    const p = new DefaultTokenProvider(cfg as never);
    await p.getAnonymousToken();
    p.invalidateAnonymous();
    expect((await p.getAnonymousToken()).accessToken).toBe("anon-2");
  });

  it("concurrent anonymous calls share one request", async () => {
    const p = new DefaultTokenProvider(cfg as never);
    await Promise.all([p.getAnonymousToken(), p.getAnonymousToken()]);
    expect(loginHits).toBe(1);
  });

  it("throws if storefront credentials are missing", async () => {
    const noSf = { ...cfg, credentials: { backend: cfg.credentials.backend } };
    const p = new DefaultTokenProvider(noSf as never);
    await expect(p.getAnonymousToken()).rejects.toThrow(/storefront/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/token-provider-anon.test.ts`
Expected: FAIL — `getAnonymousToken` throws "not implemented yet"; `refreshAnonymous` missing.

- [ ] **Step 3: Replace the placeholder in `auth.ts`**

Replace the `async getAnonymousToken()` placeholder method with:

```ts
  private anonFresh(): boolean {
    return !!this.anon && Date.now() < this.anon.expiresAt;
  }

  async getAnonymousToken(): Promise<AnonymousSession> {
    if (this.anonFresh()) return this.stripExpiry(this.anon!);
    if (this.anonLock) return this.anonLock;
    const p = this.fetchAnonymous("login").finally(() => { this.anonLock = undefined; });
    this.anonLock = p;
    return p;
  }

  /** Refreshes the anonymous session, preserving its sessionId. */
  async refreshAnonymous(): Promise<AnonymousSession> {
    if (!this.anon) return this.getAnonymousToken();
    return this.fetchAnonymous("refresh");
  }

  invalidateAnonymous(): void { this.anon = undefined; }

  private stripExpiry(s: AnonymousSession & { expiresAt: number }): AnonymousSession {
    const { expiresAt: _e, ...rest } = s;
    return rest;
  }

  private async fetchAnonymous(mode: "login" | "refresh"): Promise<AnonymousSession> {
    const sf = this.cfg.credentials.storefront;
    if (!sf?.clientId) {
      throw new Error("credentials.storefront.clientId is required for anonymous tokens");
    }
    const url = new URL(`${this.cfg.host}/customerlogin/auth/anonymous/${mode}`);
    url.searchParams.set("tenant", this.cfg.tenant);
    url.searchParams.set("client_id", sf.clientId);
    if (mode === "refresh" && this.anon) {
      url.searchParams.set("refresh_token", this.anon.refreshToken);
    }
    const res = await fetch(url, { method: "GET" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new EmporixAuthError(`Anonymous token ${mode} failed`, res.status, json);
    }
    const j = json as {
      access_token: string; refresh_token: string; sessionId: string; expires_in: number;
    };
    const obtainedAt = Date.now();
    this.anon = {
      accessToken: j.access_token,
      refreshToken: j.refresh_token,
      sessionId: j.sessionId,
      expiresIn: j.expires_in,
      expiresAt: obtainedAt + (j.expires_in - this.cfg.cache.expirationBufferSeconds) * 1000,
    };
    return this.stripExpiry(this.anon);
  }
```

Also add `refreshAnonymous` and `invalidateAnonymous` to the `TokenProvider`
interface as optional members (so `resolveToken`/http can call them when
present):

```ts
// In the TokenProvider interface, add:
  /** Refresh the anonymous session, preserving sessionId. */
  refreshAnonymous?(): Promise<AnonymousSession>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/token-provider-anon.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/core/auth.ts packages/sdk/tests/token-provider-anon.test.ts
git commit -m "feat(auth): add anonymous token path with sessionId-preserving refresh"
```

---

## Task 13: `http.ts` — fetch wrapper + error mapping + auth resolution

**Files:**
- Create: `packages/sdk/src/core/http.ts`
- Test: `packages/sdk/tests/http-basic.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http as mhttp, HttpResponse } from "msw";
import { HttpClient } from "../src/core/http";
import { LevelResolver } from "../src/core/logger";
import { MemoryLogger } from "./helpers/memory-logger";
import { EmporixNotFoundError, EmporixValidationError } from "../src/core/errors";
import type { TokenProvider } from "../src/core/auth";

const provider: TokenProvider = {
  getToken: async () => "SVC-TOKEN",
  getAnonymousToken: async () => ({
    accessToken: "ANON", refreshToken: "r", sessionId: "s", expiresIn: 3599,
  }),
};

let seenAuth = "";
const server = setupServer(
  mhttp.get("https://api.emporix.io/ok", ({ request }) => {
    seenAuth = request.headers.get("authorization") ?? "";
    return HttpResponse.json({ hello: "world" });
  }),
  mhttp.get("https://api.emporix.io/missing", () =>
    HttpResponse.json({ error: "nope" }, { status: 404 })),
  mhttp.post("https://api.emporix.io/bad", () =>
    HttpResponse.json({ error: "bad" }, { status: 422 })),
);
beforeAll(() => server.listen());
afterEach(() => { server.resetHandlers(); seenAuth = ""; });
afterAll(() => server.close());

function makeClient() {
  const resolver = new LevelResolver({ level: "trace" });
  const logger = new MemoryLogger(resolver, { service: "http" });
  return {
    logger,
    client: new HttpClient({
      host: "https://api.emporix.io",
      provider,
      logger,
      retry: { maxAttempts: 3 },
      timeouts: { connectMs: 1000, readMs: 1000 },
    }),
  };
}

describe("HttpClient", () => {
  it("resolves AuthContext into a Bearer header and parses JSON", async () => {
    const { client } = makeClient();
    const r = await client.request<{ hello: string }>({
      method: "GET", path: "/ok", auth: { kind: "service" },
    });
    expect(r.hello).toBe("world");
    expect(seenAuth).toBe("Bearer SVC-TOKEN");
  });

  it("maps 404 → EmporixNotFoundError, 422 → EmporixValidationError", async () => {
    const { client } = makeClient();
    await expect(client.request({ method: "GET", path: "/missing", auth: { kind: "service" } }))
      .rejects.toBeInstanceOf(EmporixNotFoundError);
    await expect(client.request({ method: "POST", path: "/bad", auth: { kind: "service" } }))
      .rejects.toBeInstanceOf(EmporixValidationError);
  });

  it("logs the auth kind but never the token value", async () => {
    const { client, logger } = makeClient();
    await client.request({ method: "GET", path: "/ok", auth: { kind: "service" } });
    const dump = JSON.stringify(logger.entries);
    expect(dump).not.toContain("SVC-TOKEN");
    expect(dump).toContain("service");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/http-basic.test.ts`
Expected: FAIL — cannot resolve `../src/core/http`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { type AuthContext, type TokenProvider, resolveToken } from "./auth";
import { errorFromResponse } from "./errors";
import type { Logger } from "./logger";

/** A single HTTP request through the SDK. */
export interface RequestOptions {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  auth: AuthContext;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** Per-request abort timeout override (ms). */
  timeoutMs?: number;
}

/** Construction options for {@link HttpClient}. */
export interface HttpClientOptions {
  host: string;
  provider: TokenProvider;
  logger: Logger;
  retry: { maxAttempts: number };
  timeouts: { connectMs: number; readMs: number };
}

let requestSeq = 0;

/** Fetch wrapper: auth resolution, JSON parsing, typed error mapping, logging. */
export class HttpClient {
  constructor(private readonly opts: HttpClientOptions) {}

  async request<T = unknown>(o: RequestOptions): Promise<T> {
    const requestId = `req-${++requestSeq}`;
    const log = this.opts.logger.child({ requestId });
    const url = new URL(this.opts.host + o.path);
    for (const [k, v] of Object.entries(o.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const token = await resolveToken(o.auth, this.opts.provider);
    log.debug("http request", { authKind: o.auth.kind, method: o.method, url: url.pathname });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), o.timeoutMs ?? this.opts.timeouts.readMs);
    let res: Response;
    try {
      res = await fetch(url, {
        method: o.method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(o.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    const parsed = text ? safeJson(text) : undefined;
    if (!res.ok) {
      log.warn("http error", { authKind: o.auth.kind, status: res.status });
      throw errorFromResponse(res.status, `${o.method} ${o.path} → ${res.status}`, parsed);
    }
    log.debug("http ok", { status: res.status });
    return parsed as T;
  }
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/http-basic.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/core/http.ts packages/sdk/tests/http-basic.test.ts
git commit -m "feat(http): add fetch wrapper with auth resolution and error mapping"
```

---

## Task 14: `http.ts` — retry/backoff + 401 asymmetry

**Files:**
- Modify: `packages/sdk/src/core/http.ts` (add retry loop + 401 handling)
- Test: `packages/sdk/tests/http-retry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { setupServer } from "msw/node";
import { http as mhttp, HttpResponse } from "msw";
import { HttpClient } from "../src/core/http";
import { LevelResolver } from "../src/core/logger";
import { MemoryLogger } from "./helpers/memory-logger";
import { EmporixAuthError } from "../src/core/errors";
import type { TokenProvider } from "../src/core/auth";

let invalidated = 0;
const provider: TokenProvider = {
  getToken: async () => `svc-${invalidated}`,
  getAnonymousToken: async () => ({
    accessToken: "anon", refreshToken: "r", sessionId: "s", expiresIn: 3599,
  }),
  invalidate: () => { invalidated += 1; },
};

let attempts = 0;
let customerCalls = 0;
const server = setupServer(
  mhttp.get("https://api.emporix.io/flaky", () => {
    attempts += 1;
    if (attempts < 3) return HttpResponse.json({ e: 1 }, { status: 503 });
    return HttpResponse.json({ ok: true });
  }),
  mhttp.get("https://api.emporix.io/rated", () =>
    HttpResponse.json({ e: 1 }, { status: 429, headers: { "Retry-After": "0" } })),
  mhttp.get("https://api.emporix.io/svc401", () => {
    attempts += 1;
    if (attempts === 1) return HttpResponse.json({ e: 1 }, { status: 401 });
    return HttpResponse.json({ ok: true });
  }),
  mhttp.get("https://api.emporix.io/cust401", () => {
    customerCalls += 1;
    return HttpResponse.json({ e: 1 }, { status: 401 });
  }),
);
beforeAll(() => server.listen());
afterEach(() => { server.resetHandlers(); attempts = 0; customerCalls = 0; invalidated = 0; });
afterAll(() => server.close());

function client() {
  const r = new LevelResolver({ level: "silent" });
  return new HttpClient({
    host: "https://api.emporix.io",
    provider,
    logger: new MemoryLogger(r, { service: "http" }),
    retry: { maxAttempts: 3 },
    timeouts: { connectMs: 500, readMs: 500 },
  });
}

describe("HttpClient retry + 401 asymmetry", () => {
  it("retries 5xx with backoff until success", async () => {
    vi.spyOn(globalThis, "setTimeout").mockImplementation((fn: never) => { (fn as () => void)(); return 0 as never; });
    const r = await client().request<{ ok: boolean }>({
      method: "GET", path: "/flaky", auth: { kind: "service" },
    });
    expect(r.ok).toBe(true);
    expect(attempts).toBe(3);
    vi.restoreAllMocks();
  });

  it("retries 429 respecting Retry-After then exhausts to a typed error", async () => {
    await expect(client().request({ method: "GET", path: "/rated", auth: { kind: "service" } }))
      .rejects.toThrow();
  });

  it("SDK-managed 401 invalidates, refreshes and retries once", async () => {
    const r = await client().request<{ ok: boolean }>({
      method: "GET", path: "/svc401", auth: { kind: "service" },
    });
    expect(r.ok).toBe(true);
    expect(invalidated).toBe(1);
  });

  it("caller-managed 401 throws immediately, no retry", async () => {
    await expect(client().request({
      method: "GET", path: "/cust401", auth: { kind: "customer", token: "C" },
    })).rejects.toBeInstanceOf(EmporixAuthError);
    expect(customerCalls).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/http-retry.test.ts`
Expected: FAIL — current `request` has no retry/401 handling (svc401 throws, flaky throws).

- [ ] **Step 3: Replace the `request` method body with the retry-aware version**

Replace the `HttpClient.request` method with:

```ts
  async request<T = unknown>(o: RequestOptions): Promise<T> {
    const requestId = `req-${++requestSeq}`;
    const log = this.opts.logger.child({ requestId });
    const url = new URL(this.opts.host + o.path);
    for (const [k, v] of Object.entries(o.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const sdkManaged = o.auth.kind === "service" || o.auth.kind === "anonymous";
    const maxAttempts = this.opts.retry.maxAttempts;
    let reauthed = false;

    for (let attempt = 1; ; attempt++) {
      const token = await resolveToken(o.auth, this.opts.provider);
      log.debug("http request", { authKind: o.auth.kind, method: o.method, url: url.pathname, attempt });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), o.timeoutMs ?? this.opts.timeouts.readMs);
      let res: Response;
      try {
        res = await fetch(url, {
          method: o.method,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(o.body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      const text = await res.text();
      const parsed = text ? safeJson(text) : undefined;
      if (res.ok) {
        log.debug("http ok", { status: res.status });
        return parsed as T;
      }

      // 401 asymmetry.
      if (res.status === 401) {
        if (sdkManaged && !reauthed) {
          reauthed = true;
          if (o.auth.kind === "service") {
            this.opts.provider.invalidate?.(o.auth.credentials ?? "backend");
          } else {
            this.opts.provider.invalidateAnonymous?.();
          }
          log.warn("sdk-managed 401, re-authing once", { authKind: o.auth.kind });
          continue;
        }
        throw errorFromResponse(res.status, `${o.method} ${o.path} → 401`, parsed);
      }

      // Retry 5xx / 429.
      const retryable = res.status >= 500 || res.status === 429;
      if (retryable && attempt < maxAttempts) {
        const retryAfter = Number(res.headers.get("Retry-After"));
        const backoff = Number.isFinite(retryAfter) && retryAfter >= 0
          ? retryAfter * 1000
          : Math.min(1000 * 2 ** (attempt - 1), 8000) + Math.random() * 100;
        log.warn("retryable failure", { status: res.status, attempt, backoffMs: backoff });
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }

      log.error("http error (final)", { status: res.status, attempt });
      throw errorFromResponse(res.status, `${o.method} ${o.path} → ${res.status}`, parsed);
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/http-retry.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the basic http test again to confirm no regression**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/http-basic.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/core/http.ts packages/sdk/tests/http-retry.test.ts
git commit -m "feat(http): add retry/backoff and SDK-vs-caller 401 asymmetry"
```

---

## Task 15: Public exports, full verification, changeset

**Files:**
- Modify: `packages/sdk/src/index.ts`
- Create: `.changeset/foundation.md`

- [ ] **Step 1: Populate `packages/sdk/src/index.ts`**

```ts
export {
  EmporixError, EmporixAuthError, EmporixForbiddenError, EmporixNotFoundError,
  EmporixValidationError, EmporixServerError, errorFromResponse,
} from "./core/errors";
export { validateConfig, DEFAULT_HOST } from "./core/config";
export type {
  EmporixConfig, ResolvedConfig, ServiceCredentials, StorefrontCredentials,
} from "./core/config";
export {
  LEVEL, LevelResolver, createConsoleLogger, createNoopLogger, redact,
} from "./core/logger";
export type {
  LogLevel, Logger, LogFields, LoggerConfig, LoggerObjectConfig, ServiceName,
} from "./core/logger";
export { auth, resolveToken, DefaultTokenProvider } from "./core/auth";
export type { AuthKind, AuthContext, AnonymousSession, TokenProvider } from "./core/auth";
export { HttpClient } from "./core/http";
export type { RequestOptions, HttpClientOptions } from "./core/http";
```

- [ ] **Step 2: Full typecheck**

Run: `pnpm --filter @viu/emporix-sdk typecheck`
Expected: PASS. If `config.ts`'s type-only imports of `./logger`/`./auth` error,
they now resolve (both modules exist) — fix any genuine type mismatch surfaced
here before continuing.

- [ ] **Step 3: Full lint**

Run: `pnpm --filter @viu/emporix-sdk lint`
Expected: PASS — no `no-console` violations outside `logger.ts`, no default exports.

- [ ] **Step 4: Full test suite with coverage**

Run: `pnpm --filter @viu/emporix-sdk test`
Expected: all test files PASS; coverage lines ≥ 80% and branches ≥ 80%.
If a threshold fails, add focused tests for the uncovered branch (do not lower
the threshold).

- [ ] **Step 5: Build**

Run: `pnpm --filter @viu/emporix-sdk build`
Expected: `dist/index.js`, `dist/index.cjs`, `dist/index.d.ts` emitted; no errors.

- [ ] **Step 6: Root verification (mirrors CI)**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: all PASS.

- [ ] **Step 7: Create `.changeset/foundation.md`**

```md
---
"@viu/emporix-sdk": minor
---

Add SDK foundation: config validation, EmporixError hierarchy, per-service
logger with redaction, TokenProvider (service + anonymous with
sessionId-preserving refresh), and the HTTP client with retry and 401
asymmetry.
```

- [ ] **Step 8: Commit**

```bash
git add packages/sdk/src/index.ts .changeset/foundation.md
git commit -m "feat(sdk): export core public API and declare foundation changeset"
```

---

## Self-Review

**Spec coverage (sections 3.1–3.3, 4, 5):**
- 3.1 Config + tenant guard → Task 7. Credential shapes (`storefront` clientId-only) → Tasks 7, 12. ✓
- 3.2 `AuthContext`/`auth`/`resolveToken` → Task 10; `TokenProvider` 3 paths (service/custom Task 11, anonymous + sessionId-preserving refresh Task 12; external injection — interface in Task 10, composition deferred to Plan 2's `EmporixClient`). ✓
- 3.3 HTTP fetch wrapper, error mapping, retry+jitter+Retry-After, 401 asymmetry, AbortController timeout, token-kind-only logging → Tasks 13–14. (`tracer` hook seam: deferred to Plan 2 where `EmporixClient` wires interceptors — noted, not a Plan 1 gap.) ✓
- 4 Versioning/release: Changesets (Task 2), commitlint+husky (Task 3), workflows (Task 4), foundation changeset (Task 15). ✓
- 5 Testing: TokenProvider caching/locks/buffer/error/anon-refresh (Tasks 11–12); AuthContext four kinds + 401 asymmetry (Tasks 10, 14); HTTP retry/timeout/error/Retry-After (Tasks 13–14); Logger level/per-service/env precedence/redaction/child/runtime-mutation/sticky-env (Tasks 8–9); secret-leak assertions embedded in Tasks 9 & 13; ≥80% coverage gate (Task 15). ✓ (Service-level `msw` integration + cross-service secret-leak happy-path scan belong to Plan 2 where services exist — intentionally out of Plan 1 scope.)

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to". The
`getAnonymousToken` placeholder in Task 11 is explicitly replaced in Task 12
with full code. Type-only forward imports in Task 7 are called out with a
concrete resolution path. ✓

**Type consistency:** `TokenProvider` (`getToken`, `getAnonymousToken`,
optional `invalidate`/`invalidateAnonymous`/`refreshAnonymous`) is consistent
across Tasks 10–14. `AnonymousSession` shape
(`accessToken/refreshToken/sessionId/expiresIn`) identical in Tasks 10, 11, 12.
`ResolvedConfig` fields used in Task 11/12 match Task 7. `HttpClientOptions`
identical in Tasks 13 & 14. `LevelResolver` API (`get/numericLevel/isAtLeast/set`)
consistent Tasks 8–14. `errorFromResponse` signature consistent Tasks 6, 13, 14. ✓
