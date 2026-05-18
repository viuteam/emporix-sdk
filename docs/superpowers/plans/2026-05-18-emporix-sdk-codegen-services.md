# Emporix SDK — Plan 2: Codegen & Services Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vendor the four Emporix OpenAPI specs, generate types from them, and hand-write the `CustomerService`, `ProductService`, `CategoryService`, `CartService` facades plus the `EmporixClient` aggregator with subpath exports — all TDD with `msw`.

**Architecture:** `fetch-specs.ts` downloads the four `api.yml` files into `packages/sdk/specs/` (committed). `generate.ts` runs `@hey-api/openapi-ts` per spec into `src/generated/<service>/` (types only). Hand-written facades in `src/services/*` take a shared `ClientContext` (built in Plan 1: config + http + tokenProvider + logger), inject `tenant`, apply per-service default `AuthContext`, and map wire shapes to idiomatic names. `EmporixClient` composes everything.

**Tech Stack:** `@hey-api/openapi-ts` (codegen), Plan 1 core (`HttpClient`, `DefaultTokenProvider`, `validateConfig`, logger), vitest + msw.

**Spec:** `docs/superpowers/specs/2026-05-17-emporix-sdk-design.md` (sections 3.4, 3.2 per-service defaults; milestones 4–9).

**Validated Emporix facts (live docs, 2026-05-18):**
- Public raw spec URLs (no auth):
  - customer: `https://raw.githubusercontent.com/emporix/api-references/refs/heads/main/companies-and-customers/customer-management/api-reference/api.yml`
  - product: `https://raw.githubusercontent.com/emporix/api-references/refs/heads/main/products-labels-and-brands/product-service/api-reference/api.yml`
  - category: `https://raw.githubusercontent.com/emporix/api-references/refs/heads/main/catalogs-and-categories/category-tree/api-reference/api.yml`
  - cart: `https://raw.githubusercontent.com/emporix/api-references/refs/heads/main/checkout/cart/api-reference/api.yml`
- Customer service used is **customer-managed** (`/customer/{tenant}/me/...`, `CustomerAccessToken` bearer).
- Confirmed paths: anonymous `GET /customerlogin/auth/anonymous/login`, login `POST /customer/{tenant}/login`, me `GET /customer/{tenant}/me`, addresses `/customer/{tenant}/me/addresses[/{id}]`, cart merge `POST /cart/{tenant}/carts/{cartId}/merge`.
- Source-of-truth rule: vendored YAML wins; facade maps wire → idiomatic names with a code comment.

---

## File Structure (this plan)

```
packages/sdk/scripts/fetch-specs.ts      download 4 api.yml → specs/ (committed)
packages/sdk/scripts/generate.ts         @hey-api/openapi-ts per spec → src/generated/<svc>/
packages/sdk/specs/{customer,product,category,cart}.yml   vendored, committed
packages/sdk/src/generated/<svc>/*       AUTO-GENERATED, banner-prefixed, gitignored from lint
packages/sdk/src/core/context.ts         ClientContext type + Page<T> + paginate() helper
packages/sdk/src/services/customer.ts    CustomerService facade
packages/sdk/src/services/product.ts     ProductService facade
packages/sdk/src/services/category.ts    CategoryService facade
packages/sdk/src/services/cart.ts        CartService facade
packages/sdk/src/client.ts               EmporixClient aggregator
packages/sdk/src/index.ts                + service/client exports
packages/sdk/package.json                + generate script, subpath exports, @hey-api dep
packages/sdk/tsup.config.ts              + per-service entry points
packages/sdk/tests/services/*.test.ts    msw integration per service
packages/sdk/tests/client.test.ts        aggregator + tenant injection + auth defaults
```

Generated code is excluded from eslint (`src/generated/**`) and coverage (already excluded in Plan 1 vitest config). Facades are small and single-responsibility; `context.ts` holds shared plumbing so services stay focused.

---

## Task 1: Spec fetch script + vendored specs

**Files:**
- Create: `packages/sdk/scripts/fetch-specs.ts`, `packages/sdk/specs/.gitkeep`
- Modify: `packages/sdk/package.json` (add `fetch:specs` script)

- [ ] **Step 1: Create `packages/sdk/scripts/fetch-specs.ts`**

```ts
/* eslint-disable no-console */
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://raw.githubusercontent.com/emporix/api-references/refs/heads/main";
const SPECS: Record<string, string> = {
  customer: `${BASE}/companies-and-customers/customer-management/api-reference/api.yml`,
  product: `${BASE}/products-labels-and-brands/product-service/api-reference/api.yml`,
  category: `${BASE}/catalogs-and-categories/category-tree/api-reference/api.yml`,
  cart: `${BASE}/checkout/cart/api-reference/api.yml`,
};

async function main(): Promise<void> {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "specs");
  await mkdir(dir, { recursive: true });
  for (const [name, url] of Object.entries(SPECS)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${name} spec: ${res.status} ${url}`);
    const yaml = await res.text();
    await writeFile(join(dir, `${name}.yml`), yaml, "utf8");
    console.log(`fetched ${name} (${yaml.length} bytes)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Add the script to `packages/sdk/package.json`**

In `"scripts"`, add: `"fetch:specs": "tsx scripts/fetch-specs.ts"` and add `"tsx": "^4.19.0"` to `devDependencies`.

- [ ] **Step 3: Install and run the fetch**

Run: `pnpm install`
Run: `pnpm --filter @viu/emporix-sdk fetch:specs`
Expected: prints four `fetched <name> (<n> bytes)` lines; `packages/sdk/specs/{customer,product,category,cart}.yml` exist.

- [ ] **Step 4: Verify specs are valid OpenAPI**

Run: `head -3 packages/sdk/specs/customer.yml`
Expected: contains `openapi:` and `info:` (a valid OpenAPI document root).

- [ ] **Step 5: Commit (vendored specs are committed for reproducible codegen)**

```bash
git add packages/sdk/scripts/fetch-specs.ts packages/sdk/specs packages/sdk/package.json pnpm-lock.yaml
git commit -m "feat(sdk): add spec fetch script and vendor Emporix OpenAPI specs"
```

---

## Task 2: Codegen script + generated types

**Files:**
- Create: `packages/sdk/scripts/generate.ts`
- Modify: `packages/sdk/package.json` (`generate` script, `@hey-api/openapi-ts` dep), `eslint.config.js` (ignore generated), `.gitignore` is unchanged (generated code IS committed for build determinism)

- [ ] **Step 1: Add dependency and script**

In `packages/sdk/package.json`: add `"@hey-api/openapi-ts": "^0.64.0"` to `devDependencies`; add `"generate": "tsx scripts/generate.ts"` to `scripts`.

- [ ] **Step 2: Create `packages/sdk/scripts/generate.ts`**

```ts
/* eslint-disable no-console */
import { createClient } from "@hey-api/openapi-ts";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const specsDir = join(root, "specs");
const outRoot = join(root, "src", "generated");
const BANNER = "// AUTO-GENERATED — do not edit\n";

async function prependBanner(dir: string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      await prependBanner(p);
    } else if (entry.name.endsWith(".ts")) {
      const src = await readFile(p, "utf8");
      if (!src.startsWith(BANNER)) await writeFile(p, BANNER + src, "utf8");
    }
  }
}

async function main(): Promise<void> {
  const specs = (await readdir(specsDir)).filter((f) => f.endsWith(".yml"));
  for (const file of specs) {
    const name = file.replace(/\.yml$/, "");
    const output = join(outRoot, name);
    await createClient({
      input: join(specsDir, file),
      output,
      plugins: ["@hey-api/typescript"], // types only — no runtime client
    });
    await prependBanner(output);
    console.log(`generated ${name}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 3: Ignore generated code in eslint**

In `packages/sdk/eslint.config.js`, add as the first array element:

```js
  { ignores: ["src/generated/**", "dist/**"] },
```

- [ ] **Step 4: Install and generate**

Run: `pnpm install`
Run: `pnpm --filter @viu/emporix-sdk generate`
Expected: prints `generated customer/product/category/cart`; `src/generated/<svc>/` populated; every `.ts` starts with the banner.

- [ ] **Step 5: Verify generated types compile and identify key type names**

Run: `pnpm --filter @viu/emporix-sdk exec tsc --noEmit`
Expected: PASS.
Run: `grep -rl "export type" packages/sdk/src/generated/customer | head`
Expected: lists generated type modules. Note the exported type names for Customer/Address (used by the facade in Task 4 — the implementer reads the actual generated names here; they are referenced as `Gen.<Name>` via `import * as Gen`).

- [ ] **Step 6: Commit (generated code committed for deterministic builds)**

```bash
git add packages/sdk/scripts/generate.ts packages/sdk/src/generated packages/sdk/package.json packages/sdk/eslint.config.js pnpm-lock.yaml
git commit -m "feat(sdk): add openapi-ts codegen and generate service types"
```

---

## Task 3: Shared service context + pagination

**Files:**
- Create: `packages/sdk/src/core/context.ts`
- Test: `packages/sdk/tests/context.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { paginate, type Page } from "../src/core/context";

describe("paginate", () => {
  it("iterates pages until a short page is returned", async () => {
    const pages: Record<number, number[]> = { 0: [1, 2], 1: [3, 4], 2: [5] };
    const seen: number[] = [];
    const fetchPage = async (offset: number, limit: number): Promise<Page<number>> => {
      const items = pages[offset / limit] ?? [];
      return { items, total: 5, offset, limit };
    };
    for await (const n of paginate(fetchPage, 2)) seen.push(n);
    expect(seen).toEqual([1, 2, 3, 4, 5]);
  });

  it("stops when total is reached even on a full last page", async () => {
    const fetchPage = async (offset: number, limit: number): Promise<Page<number>> => ({
      items: offset === 0 ? [1, 2] : [3, 4],
      total: 4,
      offset,
      limit,
    });
    const seen: number[] = [];
    for await (const n of paginate(fetchPage, 2)) seen.push(n);
    expect(seen).toEqual([1, 2, 3, 4]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/context.test.ts`
Expected: FAIL — cannot resolve `../src/core/context`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { HttpClient } from "./http";
import type { TokenProvider, AuthContext } from "./auth";
import type { Logger } from "./logger";

/** Shared dependencies every service facade receives. */
export interface ClientContext {
  tenant: string;
  http: HttpClient;
  tokenProvider: TokenProvider;
  logger: Logger;
}

/** A single page of a paginated collection. */
export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

/** Default `AuthContext` applied by a service when the caller passes none. */
export type DefaultAuth = AuthContext | undefined;

/**
 * Async-iterates every item across pages. `fetchPage(offset, limit)` returns a
 * {@link Page}; iteration stops on a short page or once `total` is reached.
 */
export async function* paginate<T>(
  fetchPage: (offset: number, limit: number) => Promise<Page<T>>,
  limit = 50,
): AsyncIterable<T> {
  let offset = 0;
  for (;;) {
    const page = await fetchPage(offset, limit);
    for (const item of page.items) yield item;
    offset += page.items.length;
    if (page.items.length < limit) return;
    if (Number.isFinite(page.total) && offset >= page.total) return;
    if (page.items.length === 0) return;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/context.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/core/context.ts packages/sdk/tests/context.test.ts
git commit -m "feat(core): add ClientContext, Page<T> and paginate helper"
```

---

## Task 4: CustomerService

**Files:**
- Create: `packages/sdk/src/services/customer.ts`
- Test: `packages/sdk/tests/services/customer.test.ts`

Endpoints (validated): `GET /customerlogin/auth/anonymous/login`, `POST /customer/{tenant}/login`,
`POST /customer/{tenant}/signup`, `GET /customer/{tenant}/me`, `PUT /customer/{tenant}/me`,
`PUT /customer/{tenant}/password` (change), `POST /customer/{tenant}/password/reset` (request),
`POST /customer/{tenant}/password/reset/confirm` (confirm),
`GET|POST /customer/{tenant}/me/addresses`, `PUT|DELETE /customer/{tenant}/me/addresses/{id}`.
Wire→facade mapping: login response `accessToken`→`customerToken`, keep `saasToken`,
`refreshToken`. Defaults: signup/login/password-reset → `{ kind: 'anonymous' }`;
me/update/changePassword/addresses → require `customer`|`raw` (throw `EmporixAuthError`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { CustomerService } from "../../src/services/customer";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";
import { EmporixAuthError } from "../../src/core/errors";

const SESSION = "sess-1";
const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon-tok", token_type: "Bearer", expires_in: 3599,
      refresh_token: "anon-rt", sessionId: SESSION, scope: "tenant=acme",
    }),
  ),
  http.post("https://api.emporix.io/customer/acme/login", async ({ request }) => {
    expect(request.headers.get("authorization")).toBe("Bearer anon-tok");
    const body = (await request.json()) as { email: string };
    expect(body.email).toBe("a@b.co");
    return HttpResponse.json({
      accessToken: "cust-tok", saasToken: "saas-tok", refreshToken: "cust-rt",
    });
  }),
  http.get("https://api.emporix.io/customer/acme/me", ({ request }) => {
    expect(request.headers.get("authorization")).toBe("Bearer cust-tok");
    return HttpResponse.json({ id: "c1", email: "a@b.co", firstName: "A" });
  }),
  http.get("https://api.emporix.io/customer/acme/me/addresses", () =>
    HttpResponse.json([{ id: "ad1", city: "Berlin" }]),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function svc() {
  const cfg = {
    tenant: "acme",
    host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "customer" });
  const http = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new CustomerService({ tenant: "acme", http, tokenProvider, logger });
}

describe("CustomerService", () => {
  it("anonymous() returns the full session including sessionId", async () => {
    const s = await svc().anonymous();
    expect(s.accessToken).toBe("anon-tok");
    expect(s.sessionId).toBe(SESSION);
    expect(s.refreshToken).toBe("anon-rt");
  });

  it("login() threads the anonymous token and maps accessToken→customerToken", async () => {
    const r = await svc().login({ email: "a@b.co", password: "p" });
    expect(r.customerToken).toBe("cust-tok");
    expect(r.saasToken).toBe("saas-tok");
    expect(r.refreshToken).toBe("cust-rt");
  });

  it("me() requires a customer/raw context", async () => {
    const s = svc();
    await expect(s.me()).rejects.toBeInstanceOf(EmporixAuthError);
    const me = await s.me({ kind: "customer", token: "cust-tok" });
    expect(me.email).toBe("a@b.co");
  });

  it("addresses.list() requires a customer/raw context and returns typed rows", async () => {
    const s = svc();
    await expect(s.addresses.list()).rejects.toBeInstanceOf(EmporixAuthError);
    const rows = await s.addresses.list({ kind: "customer", token: "cust-tok" });
    expect(rows[0]?.city).toBe("Berlin");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/services/customer.test.ts`
Expected: FAIL — cannot resolve `../../src/services/customer`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext, AnonymousSession } from "../core/auth";
import { EmporixAuthError } from "../core/errors";

/** Caller-owned customer session (wire `accessToken` is exposed as `customerToken`). */
export interface CustomerSession {
  customerToken: string;
  saasToken: string;
  refreshToken: string;
}

/** Minimal customer profile (subset; full type comes from generated specs). */
export interface Customer {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

/** A customer address (subset; full type comes from generated specs). */
export interface Address {
  id: string;
  city?: string;
  street?: string;
  zipCode?: string;
  country?: string;
}

function requireCustomer(auth: AuthContext | undefined): AuthContext {
  if (auth && (auth.kind === "customer" || auth.kind === "raw")) return auth;
  throw new EmporixAuthError("This operation requires a customer or raw AuthContext");
}

/** Customer signup, session, profile and addresses. */
export class CustomerService {
  constructor(private readonly ctx: ClientContext) {}

  private get log() {
    return this.ctx.logger;
  }

  /** Obtains an anonymous storefront session (accessToken + sessionId + refreshToken). */
  async anonymous(): Promise<AnonymousSession> {
    return this.ctx.tokenProvider.getAnonymousToken();
  }

  /** Registers a customer. Default auth: anonymous. */
  async signup(
    input: { email: string; password: string; firstName?: string; lastName?: string },
    auth: AuthContext = { kind: "anonymous" },
  ): Promise<Customer> {
    return this.ctx.http.request<Customer>({
      method: "POST",
      path: `/customer/${this.ctx.tenant}/signup`,
      auth,
      body: input,
    });
  }

  /**
   * Logs a customer in. Threads the anonymous token so the session (and its
   * cart) survives — losing it silently creates a new session per Emporix docs.
   * Wire `accessToken` is mapped to `customerToken`.
   */
  async login(
    creds: { email: string; password: string },
    opts: { anonymousToken?: string } = {},
    auth: AuthContext = { kind: "anonymous" },
  ): Promise<CustomerSession> {
    const effective: AuthContext = opts.anonymousToken
      ? { kind: "raw", token: opts.anonymousToken }
      : auth;
    const wire = await this.ctx.http.request<{
      accessToken: string;
      saasToken: string;
      refreshToken: string;
    }>({
      method: "POST",
      path: `/customer/${this.ctx.tenant}/login`,
      auth: effective,
      body: creds,
    });
    // Wire→facade mapping (vendored spec is source of truth; see design §2).
    return {
      customerToken: wire.accessToken,
      saasToken: wire.saasToken,
      refreshToken: wire.refreshToken,
    };
  }

  /** Returns the authenticated customer. Requires customer/raw auth. */
  async me(auth?: AuthContext): Promise<Customer> {
    return this.ctx.http.request<Customer>({
      method: "GET",
      path: `/customer/${this.ctx.tenant}/me`,
      auth: requireCustomer(auth),
    });
  }

  /** Updates the authenticated customer. Requires customer/raw auth. */
  async update(patch: Partial<Customer>, auth?: AuthContext): Promise<Customer> {
    return this.ctx.http.request<Customer>({
      method: "PUT",
      path: `/customer/${this.ctx.tenant}/me`,
      auth: requireCustomer(auth),
      body: patch,
    });
  }

  /** Changes the password. Requires customer/raw auth. */
  async changePassword(
    input: { old: string; new: string },
    auth?: AuthContext,
  ): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `/customer/${this.ctx.tenant}/password`,
      auth: requireCustomer(auth),
      body: { oldPassword: input.old, newPassword: input.new },
    });
  }

  /** Requests a password reset email. Default auth: anonymous. */
  async requestPasswordReset(
    input: { email: string },
    auth: AuthContext = { kind: "anonymous" },
  ): Promise<void> {
    await this.ctx.http.request<void>({
      method: "POST",
      path: `/customer/${this.ctx.tenant}/password/reset`,
      auth,
      body: input,
    });
  }

  /** Confirms a password reset. Default auth: anonymous. */
  async confirmPasswordReset(
    input: { token: string; newPassword: string },
    auth: AuthContext = { kind: "anonymous" },
  ): Promise<void> {
    await this.ctx.http.request<void>({
      method: "POST",
      path: `/customer/${this.ctx.tenant}/password/reset/confirm`,
      auth,
      body: input,
    });
  }

  /** Address sub-resource. All operations require customer/raw auth. */
  readonly addresses = {
    list: (auth?: AuthContext): Promise<Address[]> =>
      this.ctx.http.request<Address[]>({
        method: "GET",
        path: `/customer/${this.ctx.tenant}/me/addresses`,
        auth: requireCustomer(auth),
      }),
    add: (address: Omit<Address, "id">, auth?: AuthContext): Promise<Address> =>
      this.ctx.http.request<Address>({
        method: "POST",
        path: `/customer/${this.ctx.tenant}/me/addresses`,
        auth: requireCustomer(auth),
        body: address,
      }),
    update: (id: string, patch: Partial<Address>, auth?: AuthContext): Promise<Address> =>
      this.ctx.http.request<Address>({
        method: "PUT",
        path: `/customer/${this.ctx.tenant}/me/addresses/${id}`,
        auth: requireCustomer(auth),
        body: patch,
      }),
    remove: (id: string, auth?: AuthContext): Promise<void> =>
      this.ctx.http.request<void>({
        method: "DELETE",
        path: `/customer/${this.ctx.tenant}/me/addresses/${id}`,
        auth: requireCustomer(auth),
      }),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/services/customer.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/customer.ts packages/sdk/tests/services/customer.test.ts
git commit -m "feat(customer): add CustomerService facade with session threading"
```

---

## Task 5: ProductService

**Files:**
- Create: `packages/sdk/src/services/product.ts`
- Test: `packages/sdk/tests/services/product.test.ts`

Endpoints: `GET /product/{tenant}/products/{id}`, `GET /product/{tenant}/products?q=code:{code}`,
`GET /product/{tenant}/products` (paged via `pageNumber`/`pageSize`, total in
`X-Total-Count` header), `GET /product/{tenant}/products/{id}/media`. Defaults:
reads → `{ kind: 'anonymous' }`. Personalized read = caller passes `{ kind: 'customer' }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { ProductService } from "../../src/services/product";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";

let seenAuth: string[] = [];
const server = setupServer(
  http.get("https://api.emporix.io/oauth/token", () => HttpResponse.json({})),
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
  http.get("https://api.emporix.io/product/acme/products/p1", ({ request }) => {
    seenAuth.push(request.headers.get("authorization") ?? "");
    return HttpResponse.json({ id: "p1", name: "Widget" });
  }),
  http.get("https://api.emporix.io/product/acme/products", ({ request }) => {
    const u = new URL(request.url);
    const page = Number(u.searchParams.get("pageNumber") ?? "1");
    const items = page === 1 ? [{ id: "p1" }, { id: "p2" }] : [{ id: "p3" }];
    return HttpResponse.json(items, { headers: { "X-Total-Count": "3" } });
  }),
);
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  seenAuth = [];
});
afterAll(() => server.close());

function svc() {
  const cfg = {
    tenant: "acme", host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "product" });
  const http = new HttpClient({
    host: "https://api.emporix.io", provider: tokenProvider, logger,
    retry: { maxAttempts: 1 }, timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new ProductService({ tenant: "acme", http, tokenProvider, logger });
}

describe("ProductService", () => {
  it("get() defaults to anonymous auth", async () => {
    const p = await svc().get("p1");
    expect(p.id).toBe("p1");
    expect(seenAuth[0]).toBe("Bearer anon");
  });

  it("get() honours a customer context for personalized reads", async () => {
    await svc().get("p1", undefined, { kind: "customer", token: "CUST" });
    expect(seenAuth[0]).toBe("Bearer CUST");
  });

  it("listAll() yields every item across pages", async () => {
    const ids: string[] = [];
    for await (const p of svc().listAll({ pageSize: 2 })) ids.push(p.id as string);
    expect(ids).toEqual(["p1", "p2", "p3"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/services/product.test.ts`
Expected: FAIL — cannot resolve `../../src/services/product`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { ClientContext, Page } from "../core/context";
import { paginate } from "../core/context";
import type { AuthContext } from "../core/auth";

const ANON: AuthContext = { kind: "anonymous" };

/** A product (subset; full type comes from generated specs). */
export interface Product {
  id: string;
  name?: string;
  code?: string;
  [k: string]: unknown;
}

/** A product media entry. */
export interface Media {
  id: string;
  url?: string;
  [k: string]: unknown;
}

/** Catalog reads. Default auth: anonymous; pass customer for personalized pricing. */
export class ProductService {
  constructor(private readonly ctx: ClientContext) {}

  /** Fetches one product by id. */
  async get(
    productId: string,
    _opts?: Record<string, never>,
    auth: AuthContext = ANON,
  ): Promise<Product> {
    return this.ctx.http.request<Product>({
      method: "GET",
      path: `/product/${this.ctx.tenant}/products/${productId}`,
      auth,
    });
  }

  /** Fetches one product by its code. */
  async getByCode(code: string, auth: AuthContext = ANON): Promise<Product> {
    const rows = await this.ctx.http.request<Product[]>({
      method: "GET",
      path: `/product/${this.ctx.tenant}/products`,
      query: { q: `code:${code}` },
      auth,
    });
    const first = rows[0];
    if (!first) throw new Error(`No product with code "${code}"`);
    return first;
  }

  /** One page of products. */
  async list(
    params: { pageNumber?: number; pageSize?: number } = {},
    auth: AuthContext = ANON,
  ): Promise<Page<Product>> {
    const pageNumber = params.pageNumber ?? 1;
    const pageSize = params.pageSize ?? 50;
    const items = await this.ctx.http.request<Product[]>({
      method: "GET",
      path: `/product/${this.ctx.tenant}/products`,
      query: { pageNumber, pageSize },
      auth,
    });
    return { items, total: Number.NaN, offset: (pageNumber - 1) * pageSize, limit: pageSize };
  }

  /** Async-iterates every product across pages. */
  listAll(
    params: { pageSize?: number } = {},
    auth: AuthContext = ANON,
  ): AsyncIterable<Product> {
    const pageSize = params.pageSize ?? 50;
    return paginate<Product>(async (offset, limit) => {
      const pageNumber = offset / limit + 1;
      const page = await this.list({ pageNumber, pageSize: limit }, auth);
      return { ...page, limit };
    }, pageSize);
  }

  /** Searches products by free-text query. */
  async search(
    query: string,
    params: { pageNumber?: number; pageSize?: number } = {},
    auth: AuthContext = ANON,
  ): Promise<Page<Product>> {
    const pageNumber = params.pageNumber ?? 1;
    const pageSize = params.pageSize ?? 50;
    const items = await this.ctx.http.request<Product[]>({
      method: "GET",
      path: `/product/${this.ctx.tenant}/products`,
      query: { q: query, pageNumber, pageSize },
      auth,
    });
    return { items, total: Number.NaN, offset: (pageNumber - 1) * pageSize, limit: pageSize };
  }

  /** Media sub-resource. */
  readonly media = {
    list: (productId: string, auth: AuthContext = ANON): Promise<Media[]> =>
      this.ctx.http.request<Media[]>({
        method: "GET",
        path: `/product/${this.ctx.tenant}/products/${productId}/media`,
        auth,
      }),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/services/product.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/product.ts packages/sdk/tests/services/product.test.ts
git commit -m "feat(product): add ProductService facade with anonymous/customer reads"
```

---

## Task 6: CategoryService

**Files:**
- Create: `packages/sdk/src/services/category.ts`
- Test: `packages/sdk/tests/services/category.test.ts`

Endpoints: `GET /category/{tenant}/categories/{id}`, `GET /category/{tenant}/categories`
(paged), `GET /category/{tenant}/categories/tree` (optional `?rootId=`),
`GET /category/{tenant}/categories/{id}/products` (paged). Default auth: anonymous.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { CategoryService } from "../../src/services/category";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
  http.get("https://api.emporix.io/category/acme/categories/c1", () =>
    HttpResponse.json({ id: "c1", name: "Books" }),
  ),
  http.get("https://api.emporix.io/category/acme/categories/tree", ({ request }) => {
    const u = new URL(request.url);
    return HttpResponse.json({ id: u.searchParams.get("rootId") ?? "root", children: [] });
  }),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function svc() {
  const cfg = {
    tenant: "acme", host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "category" });
  const http = new HttpClient({
    host: "https://api.emporix.io", provider: tokenProvider, logger,
    retry: { maxAttempts: 1 }, timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new CategoryService({ tenant: "acme", http, tokenProvider, logger });
}

describe("CategoryService", () => {
  it("get() returns a category", async () => {
    expect((await svc().get("c1")).name).toBe("Books");
  });
  it("tree() passes rootId when provided", async () => {
    expect((await svc().tree("root-7")).id).toBe("root-7");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/services/category.test.ts`
Expected: FAIL — cannot resolve `../../src/services/category`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { ClientContext, Page } from "../core/context";
import { paginate } from "../core/context";
import type { AuthContext } from "../core/auth";
import type { Product } from "./product";

const ANON: AuthContext = { kind: "anonymous" };

/** A category (subset; full type comes from generated specs). */
export interface Category {
  id: string;
  name?: string;
  [k: string]: unknown;
}

/** A node in the category tree. */
export interface CategoryNode {
  id: string;
  name?: string;
  children: CategoryNode[];
  [k: string]: unknown;
}

/** Category reads. Default auth: anonymous. */
export class CategoryService {
  constructor(private readonly ctx: ClientContext) {}

  /** Fetches one category by id. */
  async get(categoryId: string, auth: AuthContext = ANON): Promise<Category> {
    return this.ctx.http.request<Category>({
      method: "GET",
      path: `/category/${this.ctx.tenant}/categories/${categoryId}`,
      auth,
    });
  }

  /** One page of categories. */
  async list(
    params: { pageNumber?: number; pageSize?: number } = {},
    auth: AuthContext = ANON,
  ): Promise<Page<Category>> {
    const pageNumber = params.pageNumber ?? 1;
    const pageSize = params.pageSize ?? 50;
    const items = await this.ctx.http.request<Category[]>({
      method: "GET",
      path: `/category/${this.ctx.tenant}/categories`,
      query: { pageNumber, pageSize },
      auth,
    });
    return { items, total: Number.NaN, offset: (pageNumber - 1) * pageSize, limit: pageSize };
  }

  /** Async-iterates every category across pages. */
  listAll(
    params: { pageSize?: number } = {},
    auth: AuthContext = ANON,
  ): AsyncIterable<Category> {
    const pageSize = params.pageSize ?? 50;
    return paginate<Category>(async (offset, limit) => {
      const pageNumber = offset / limit + 1;
      const page = await this.list({ pageNumber, pageSize: limit }, auth);
      return { ...page, limit };
    }, pageSize);
  }

  /** Fetches the category tree, optionally rooted at `rootId`. */
  async tree(rootId?: string, auth: AuthContext = ANON): Promise<CategoryNode> {
    return this.ctx.http.request<CategoryNode>({
      method: "GET",
      path: `/category/${this.ctx.tenant}/categories/tree`,
      query: rootId ? { rootId } : {},
      auth,
    });
  }

  /** One page of products in a category. */
  async productsIn(
    categoryId: string,
    params: { pageNumber?: number; pageSize?: number } = {},
    auth: AuthContext = ANON,
  ): Promise<Page<Product>> {
    const pageNumber = params.pageNumber ?? 1;
    const pageSize = params.pageSize ?? 50;
    const items = await this.ctx.http.request<Product[]>({
      method: "GET",
      path: `/category/${this.ctx.tenant}/categories/${categoryId}/products`,
      query: { pageNumber, pageSize },
      auth,
    });
    return { items, total: Number.NaN, offset: (pageNumber - 1) * pageSize, limit: pageSize };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/services/category.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/category.ts packages/sdk/tests/services/category.test.ts
git commit -m "feat(category): add CategoryService facade with tree and productsIn"
```

---

## Task 7: CartService

**Files:**
- Create: `packages/sdk/src/services/cart.ts`
- Test: `packages/sdk/tests/services/cart.test.ts`

Endpoints: `POST /cart/{tenant}/carts`, `GET /cart/{tenant}/carts/{id}`,
`GET /cart/{tenant}/carts` (current), `POST /cart/{tenant}/carts/{id}/items`,
`PUT|DELETE /cart/{tenant}/carts/{id}/items/{itemId}`,
`POST /cart/{tenant}/carts/{id}/coupons`, `DELETE /cart/{tenant}/carts/{id}/coupons/{code}`,
`PUT /cart/{tenant}/carts/{id}/shipping-address`, `.../billing-address`,
`POST /cart/{tenant}/carts/{id}/merge`. **Every method requires an explicit
`customer` or `anonymous` AuthContext** (no default); `merge` requires `customer`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { CartService } from "../../src/services/cart";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";
import { EmporixValidationError } from "../../src/core/errors";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
  http.post("https://api.emporix.io/cart/acme/carts", ({ request }) => {
    expect(request.headers.get("authorization")).toBe("Bearer anon");
    return HttpResponse.json({ id: "cart1", items: [] });
  }),
  http.post("https://api.emporix.io/cart/acme/carts/cart1/merge", ({ request }) => {
    expect(request.headers.get("authorization")).toBe("Bearer CUST");
    return HttpResponse.json({ id: "cart-merged", items: [{ id: "i1" }] });
  }),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function svc() {
  const cfg = {
    tenant: "acme", host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "cart" });
  const http = new HttpClient({
    host: "https://api.emporix.io", provider: tokenProvider, logger,
    retry: { maxAttempts: 1 }, timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new CartService({ tenant: "acme", http, tokenProvider, logger });
}

describe("CartService", () => {
  it("refuses calls without an explicit customer/anonymous context", async () => {
    // @ts-expect-error auth is required
    await expect(svc().create()).rejects.toBeInstanceOf(EmporixValidationError);
    await expect(
      svc().create({ currency: "EUR" }, { kind: "service" } as never),
    ).rejects.toBeInstanceOf(EmporixValidationError);
  });

  it("create() works with an anonymous context", async () => {
    const c = await svc().create({ currency: "EUR" }, { kind: "anonymous" });
    expect(c.id).toBe("cart1");
  });

  it("merge() requires a customer context and returns the merged cart", async () => {
    await expect(
      svc().merge("cart1", { kind: "anonymous" }),
    ).rejects.toBeInstanceOf(EmporixValidationError);
    const merged = await svc().merge("cart1", { kind: "customer", token: "CUST" });
    expect(merged.id).toBe("cart-merged");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/services/cart.test.ts`
Expected: FAIL — cannot resolve `../../src/services/cart`.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import { EmporixValidationError } from "../core/errors";

/** A cart (subset; full type comes from generated specs). */
export interface Cart {
  id: string;
  items: Array<{ id: string; [k: string]: unknown }>;
  [k: string]: unknown;
}

/** An address payload for cart shipping/billing. */
export interface CartAddress {
  street?: string;
  city?: string;
  zipCode?: string;
  country?: string;
  [k: string]: unknown;
}

function requireCartAuth(auth: AuthContext): AuthContext {
  if (auth.kind === "customer" || auth.kind === "anonymous") return auth;
  throw new EmporixValidationError(
    "CartService requires an explicit { kind: 'customer' } or { kind: 'anonymous' } AuthContext",
  );
}

function requireCustomerAuth(auth: AuthContext): AuthContext {
  if (auth.kind === "customer") return auth;
  throw new EmporixValidationError("cart.merge requires a { kind: 'customer' } AuthContext");
}

/** Cart operations. Every method requires an explicit customer/anonymous context. */
export class CartService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/cart/${this.ctx.tenant}/carts`;
  }

  /** Creates a cart. */
  async create(input: { currency?: string; siteCode?: string } | undefined, auth: AuthContext): Promise<Cart> {
    return this.ctx.http.request<Cart>({
      method: "POST",
      path: this.base(),
      auth: requireCartAuth(auth),
      body: input ?? {},
    });
  }

  /** Fetches a cart by id. */
  async get(cartId: string, auth: AuthContext): Promise<Cart> {
    return this.ctx.http.request<Cart>({
      method: "GET",
      path: `${this.base()}/${cartId}`,
      auth: requireCartAuth(auth),
    });
  }

  /** Returns the current cart for the session, or null if none. */
  async getCurrent(auth: AuthContext): Promise<Cart | null> {
    const carts = await this.ctx.http.request<Cart[]>({
      method: "GET",
      path: this.base(),
      auth: requireCartAuth(auth),
    });
    return carts[0] ?? null;
  }

  /** Adds an item. */
  async addItem(
    cartId: string,
    item: { productId: string; quantity: number },
    auth: AuthContext,
  ): Promise<Cart> {
    return this.ctx.http.request<Cart>({
      method: "POST",
      path: `${this.base()}/${cartId}/items`,
      auth: requireCartAuth(auth),
      body: item,
    });
  }

  /** Updates an item. */
  async updateItem(
    cartId: string,
    itemId: string,
    patch: { quantity?: number },
    auth: AuthContext,
  ): Promise<Cart> {
    return this.ctx.http.request<Cart>({
      method: "PUT",
      path: `${this.base()}/${cartId}/items/${itemId}`,
      auth: requireCartAuth(auth),
      body: patch,
    });
  }

  /** Removes an item. */
  async removeItem(cartId: string, itemId: string, auth: AuthContext): Promise<Cart> {
    return this.ctx.http.request<Cart>({
      method: "DELETE",
      path: `${this.base()}/${cartId}/items/${itemId}`,
      auth: requireCartAuth(auth),
    });
  }

  /** Empties the cart. */
  async clear(cartId: string, auth: AuthContext): Promise<Cart> {
    return this.ctx.http.request<Cart>({
      method: "DELETE",
      path: `${this.base()}/${cartId}/items`,
      auth: requireCartAuth(auth),
    });
  }

  /** Applies a coupon. */
  async applyCoupon(cartId: string, code: string, auth: AuthContext): Promise<Cart> {
    return this.ctx.http.request<Cart>({
      method: "POST",
      path: `${this.base()}/${cartId}/coupons`,
      auth: requireCartAuth(auth),
      body: { code },
    });
  }

  /** Removes a coupon. */
  async removeCoupon(cartId: string, code: string, auth: AuthContext): Promise<Cart> {
    return this.ctx.http.request<Cart>({
      method: "DELETE",
      path: `${this.base()}/${cartId}/coupons/${code}`,
      auth: requireCartAuth(auth),
    });
  }

  /** Sets the shipping address. */
  async setShippingAddress(
    cartId: string,
    address: CartAddress,
    auth: AuthContext,
  ): Promise<Cart> {
    return this.ctx.http.request<Cart>({
      method: "PUT",
      path: `${this.base()}/${cartId}/shipping-address`,
      auth: requireCartAuth(auth),
      body: address,
    });
  }

  /** Sets the billing address. */
  async setBillingAddress(
    cartId: string,
    address: CartAddress,
    auth: AuthContext,
  ): Promise<Cart> {
    return this.ctx.http.request<Cart>({
      method: "PUT",
      path: `${this.base()}/${cartId}/billing-address`,
      auth: requireCartAuth(auth),
      body: address,
    });
  }

  /** Merges an anonymous cart into the customer's cart. Requires customer auth. */
  async merge(anonymousCartId: string, auth: AuthContext): Promise<Cart> {
    return this.ctx.http.request<Cart>({
      method: "POST",
      path: `${this.base()}/${anonymousCartId}/merge`,
      auth: requireCustomerAuth(auth),
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/services/cart.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/cart.ts packages/sdk/tests/services/cart.test.ts
git commit -m "feat(cart): add CartService facade requiring explicit AuthContext"
```

---

## Task 8: EmporixClient aggregator, exports, verification, changeset

**Files:**
- Create: `packages/sdk/src/client.ts`, `packages/sdk/tests/client.test.ts`
- Modify: `packages/sdk/src/index.ts`, `packages/sdk/package.json` (subpath exports), `packages/sdk/tsup.config.ts` (per-service entries)
- Create: `.changeset/codegen-services.md`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { EmporixClient } from "../src/client";
import { auth } from "../src/core/auth";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
  http.get("https://api.emporix.io/product/acme/products/p1", () =>
    HttpResponse.json({ id: "p1", name: "Widget" }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("EmporixClient", () => {
  it("validates tenant at construction", () => {
    expect(
      () => new EmporixClient({ tenant: "BAD", credentials: { backend: { clientId: "b", secret: "s" } } }),
    ).toThrow(/tenant/i);
  });

  it("exposes services with tenant injected and shares one instance", async () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    });
    const p = await sdk.products.get("p1");
    expect(p.id).toBe("p1");
    expect(sdk.customers).toBeDefined();
    expect(sdk.categories).toBeDefined();
    expect(sdk.carts).toBeDefined();
  });

  it("setLogLevel/getLogLevel proxy the resolver", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" } },
      logger: { level: "warn" },
    });
    sdk.setLogLevel("debug", { service: "cart" });
    expect(sdk.getLogLevel("cart")).toBe("debug");
    expect(auth.anonymous()).toEqual({ kind: "anonymous" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/client.test.ts`
Expected: FAIL — cannot resolve `../src/client`.

- [ ] **Step 3: Write `packages/sdk/src/client.ts`**

```ts
import { validateConfig, type EmporixConfig } from "./core/config";
import { DefaultTokenProvider, type TokenProvider } from "./core/auth";
import { HttpClient } from "./core/http";
import {
  LevelResolver, createConsoleLogger, createNoopLogger, type Logger, type LogLevel,
  type ServiceName, type LoggerObjectConfig,
} from "./core/logger";
import type { ClientContext } from "./core/context";
import { CustomerService } from "./services/customer";
import { ProductService } from "./services/product";
import { CategoryService } from "./services/category";
import { CartService } from "./services/cart";

const SDK_VERSION = "0.0.0";

/** The Emporix SDK entry point. One instance safely serves many concurrent shoppers. */
export class EmporixClient {
  readonly customers: CustomerService;
  readonly products: ProductService;
  readonly categories: CategoryService;
  readonly carts: CartService;
  private readonly resolver: LevelResolver;

  constructor(config: EmporixConfig) {
    const cfg = validateConfig(config);

    let loggerObj: LoggerObjectConfig = {};
    let baseLogger: Logger | undefined;
    if (cfg.logger === false) {
      baseLogger = createNoopLogger();
    } else if (cfg.logger && typeof (cfg.logger as Logger).child === "function") {
      baseLogger = cfg.logger as Logger;
    } else if (cfg.logger) {
      loggerObj = cfg.logger as LoggerObjectConfig;
    }
    this.resolver = new LevelResolver(loggerObj);
    const root =
      baseLogger ??
      createConsoleLogger(this.resolver, { sdk: "emporix", sdkVersion: SDK_VERSION, tenant: cfg.tenant });

    const tokenProvider: TokenProvider = cfg.tokenProvider ?? new DefaultTokenProvider(cfg);

    const mk = (service: ServiceName): ClientContext => ({
      tenant: cfg.tenant,
      tokenProvider,
      logger: root.child({ service }),
      http: new HttpClient({
        host: cfg.host,
        provider: tokenProvider,
        logger: root.child({ service: "http" }),
        retry: cfg.retry,
        timeouts: cfg.timeouts,
      }),
    });

    this.customers = new CustomerService(mk("customer"));
    this.products = new ProductService(mk("product"));
    this.categories = new CategoryService(mk("category"));
    this.carts = new CartService(mk("cart"));
  }

  /** Sets the runtime log level globally or for one service. */
  setLogLevel(level: LogLevel, opts: { service?: ServiceName; force?: boolean } = {}): void {
    this.resolver.set(level, opts.service, opts.force ?? false);
  }

  /** Returns the effective log level for a service. */
  getLogLevel(service: ServiceName): LogLevel {
    return this.resolver.get(service);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/client.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Update `packages/sdk/src/index.ts` (append service/client exports)**

Add to the existing exports:

```ts
export { EmporixClient } from "./client";
export type { ClientContext, Page } from "./core/context";
export { paginate } from "./core/context";
export { CustomerService } from "./services/customer";
export type { Customer, CustomerSession, Address } from "./services/customer";
export { ProductService } from "./services/product";
export type { Product, Media } from "./services/product";
export { CategoryService } from "./services/category";
export type { Category, CategoryNode } from "./services/category";
export { CartService } from "./services/cart";
export type { Cart, CartAddress } from "./services/cart";
```

- [ ] **Step 6: Add subpath exports + entries**

In `packages/sdk/package.json` `"exports"`, add (alongside `.`):

```json
"./customer": { "import": "./dist/customer.js", "require": "./dist/customer.cjs", "types": "./dist/customer.d.ts" },
"./product":  { "import": "./dist/product.js",  "require": "./dist/product.cjs",  "types": "./dist/product.d.ts" },
"./category": { "import": "./dist/category.js", "require": "./dist/category.cjs", "types": "./dist/category.d.ts" },
"./cart":     { "import": "./dist/cart.js",     "require": "./dist/cart.cjs",     "types": "./dist/cart.d.ts" }
```

Create barrels: `packages/sdk/src/customer.ts` → `export * from "./services/customer";`
(same for `product.ts`, `category.ts`, `cart.ts`). In `tsup.config.ts` set
`entry: ["src/index.ts", "src/customer.ts", "src/product.ts", "src/category.ts", "src/cart.ts"]`.

- [ ] **Step 7: Full verification (mirrors CI)**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: all PASS; coverage ≥ 80% per package (generated code excluded). If a
threshold fails, add focused facade tests (don't lower the threshold).

- [ ] **Step 8: Create `.changeset/codegen-services.md`**

```md
---
"@viu/emporix-sdk": minor
---

Add OpenAPI codegen pipeline and the Customer, Product, Category and Cart
service facades plus the EmporixClient aggregator with per-service subpath
exports.
```

- [ ] **Step 9: Commit**

```bash
git add packages/sdk/src packages/sdk/package.json packages/sdk/tsup.config.ts packages/sdk/tests/client.test.ts .changeset/codegen-services.md
git commit -m "feat(sdk): add EmporixClient aggregator, subpath exports and changeset"
```

---

## Self-Review

**Spec coverage (§3.4, §3.2 defaults, milestones 4–9):**
- M4 codegen: fetch-specs (Task 1, real public URLs), generate.ts + banner + types-only (Task 2). ✓
- M5 CustomerService: anonymous/login(sessionId threading)/me/update/changePassword/reset/addresses, wire→facade mapping, required-auth throws (Task 4). ✓
- M6 ProductService: get/getByCode/list/listAll/search/media, anonymous default + customer personalized read same endpoint (Task 5). ✓
- M7 CategoryService: get/list/listAll/tree/productsIn (Task 6). ✓
- M8 CartService: all methods require explicit customer/anonymous, merge requires customer (Task 7). ✓
- M9 aggregator: tenant validation, service composition, per-service child loggers, setLogLevel/getLogLevel, public + subpath exports, `auth` helper exported (Plan 1) (Task 8). ✓
- Pagination `Page<T>` + `listAll` AsyncIterable forwarding the same auth (Task 3, used in 5/6). ✓

**Placeholder scan:** No TBD/TODO. Generated type names are intentionally read at
Task 2 Step 5 (cannot be known before codegen runs); facades use hand-declared
subset interfaces and treat generated output as the wire source of truth per the
design's stated rule — this is explicit, not a placeholder.

**Type consistency:** `ClientContext` (`tenant/http/tokenProvider/logger`)
identical across context.ts and all four services and `client.ts`. `Page<T>`
shape consistent (context, product, category). `AuthContext`/`auth`/
`AnonymousSession`/`EmporixError` subclasses reused from Plan 1 unchanged.
`HttpClient.request` option shape matches Plan 1 (`method/path/auth/query/body`).
`EmporixClient` uses `LevelResolver.set/get` with the Plan 1 signature
(`set(level, svc?, force?)`).

**Deviation note:** Plan 1's `.changeset` examples-ignore glob and `tsconfig`
`rootDir` were already corrected during Plan 1 execution; Plan 4 must re-add the
`ignore: ["@viu/emporix-examples-*"]` glob once example packages exist.
