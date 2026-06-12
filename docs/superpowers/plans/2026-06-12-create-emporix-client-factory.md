# `createEmporixClient` Factory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an additive, tree-shakeable `createEmporixClient(config, services)` factory so consumers bundle only the services they use, while `EmporixClient` stays the unchanged batteries-included default.

**Architecture:** Extract the service-agnostic infrastructure from `EmporixClient`'s constructor into `createCore(config)`. Give each service class static `channel`/`deps` metadata. A new `createEmporixClient` module (importing **no** services) builds only the passed service classes via `createCore`. `EmporixClient` is re-implemented on `createCore` but still instantiates all services — its behavior is byte-identical and the existing SDK suite is the regression net.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`), Vitest + MSW (`msw/node`), esbuild (already a tsup dependency), Changesets.

**Branch & PR:** Work on `feat/create-emporix-client-factory` (already created from `main`; this plan is committed there). One PR against `main`. Commitlint: scope from allowlist (`sdk`, `core`, `docs`, `repo`), first word after scope a lowercase verb. Pre-commit runs lint + typecheck.

**Spec:** `docs/superpowers/specs/2026-06-12-create-emporix-client-factory-design.md`.

**Pre-verified facts (don't re-derive):**
- `EmporixClient` constructor: infra at `packages/sdk/src/client.ts:131-176` (logger/resolver, `tokenProvider`, `customerRefresh`, `requestContext`, the `mk(service)` closure); service instantiation at `:178-225`; public methods `setStorefrontContext`/`setLogLevel`/`getLogLevel`/`setCustomerTokenRefresher` at `:238-273`; readonly fields `tenant`/`config`/`tokenProvider`.
- `mk(service: ServiceName)` builds a `ClientContext` (`core/context.ts`): `{ tenant, tokenProvider, logger: root.child({service}), http: new HttpClient({...}) }`.
- Only `SegmentService` has constructor deps: `new SegmentService(mk("segment"), { products, categories })` (`client.ts:186-189`).
- All service classes are already exported individually from `packages/sdk/src/index.ts` (`export { ProductService } from "./services/product"`, …), so the per-export barrel is tree-shakeable; package is `"sideEffects": false`.
- `ServiceName` is the channel union (`core/logger.ts`); every value in the table below is an existing member.

---

## Task 1: Static service metadata (`channel` + `deps`)

**Files:** Modify each service class under `packages/sdk/src/services/*.ts`.

Add `static readonly channel: ServiceName = "<channel>";` as the first member of each service class, per this exact table (the channel each service is given in `client.ts`). Import `ServiceName` as a type where not already imported: `import type { ServiceName } from "../core/logger";`.

| Class | channel | | Class | channel |
|---|---|---|---|---|
| `CustomerService` | `customer` | | `RewardPointsService` | `reward-points` |
| `ProductService` | `product` | | `BrandService` | `brand` |
| `CategoryService` | `category` | | `LabelService` | `label` |
| `CartService` | `cart` | | `CountryService` | `country` |
| `CheckoutService` | `checkout` | | `CurrencyService` | `currency` |
| `PaymentGatewayService` | `payment` | | `ShippingService` | `shipping` |
| `PriceService` | `price` | | `ReturnsService` | `returns` |
| `MediaService` | `media` | | `SepaExportService` | `sepa-export` |
| `SegmentService` | `segment` | | `IndexingService` | `indexing` |
| `SiteService` | `site` | | `UnitHandlingService` | `unit-handling` |
| `SessionContextService` | `session-context` | | `CatalogService` | `catalog` |
| `CompaniesService` | `customer-management` | | `VendorService` | `vendor` |
| `ContactsService` | `customer-management` | | `PickPackService` | `pick-pack` |
| `LocationsService` | `customer-management` | | `CustomerAdminService` | `customer-admin` |
| `CustomerGroupsService` | `iam` | | `ApprovalService` | `approval` |
| `OrdersService` | `orders` | | `TenantConfigService` | `configuration` |
| `SalesOrdersService` | `sales-orders` | | `ClientConfigService` | `configuration` |
| `AvailabilityService` | `availability` | | `ShoppingListService` | `shopping-list` |
| `FeeService` | `fee` | | `RagIndexerService` | `ai-rag-indexer` |
| `CloudFunctionsService` | `cloud-functions` | | `SequentialIdService` | `sequential-id` |
| `WebhookService` | `webhook` | | `SchemaService` | `schema` |
| `AiService` | `ai` | | `TaxService` | `tax` |
| `CouponService` | `coupon` | | | |

(`OrdersService` and `SalesOrdersService` share `services/orders.ts` — both get a static. `CompaniesService`/`ContactsService`/`LocationsService` all use `customer-management`.)

- [ ] **Step 1:** Add the static `channel` to every class above.

- [ ] **Step 2:** Add deps metadata to `SegmentService` (`services/segment.ts`): `static readonly deps = ["products", "categories"] as const;` (next to its `channel`). The dep keys are the **public service-map names** the factory resolves.

- [ ] **Step 3: Run** `pnpm -F @viu/emporix-sdk test` → all 628 green (additive statics change no behavior); `pnpm typecheck` → clean (every channel is a valid `ServiceName`; a typo fails here).

- [ ] **Step 4: Commit:**

```bash
git add packages/sdk/src/services
git commit -m "feat(sdk): add static channel/deps metadata to service classes"
```

---

## Task 2: Extract `createCore` + re-implement `EmporixClient` on it

**Files:**
- Create: `packages/sdk/src/core/create-core.ts`
- Modify: `packages/sdk/src/client.ts` (constructor + the four methods delegate to core)
- Test: existing `packages/sdk/tests/**` is the regression net; add `packages/sdk/tests/create-core.test.ts`

### 2.1 Failing test for `createCore`

- [ ] **Step 1:** Create `packages/sdk/tests/create-core.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { createCore } from "../src/core/create-core";
import { ProductService } from "../src/services/product";

const server = setupServer(
  http.post("https://api.emporix.io/oauth/token", () =>
    HttpResponse.json({ access_token: "svc", token_type: "Bearer", expires_in: 3600 }),
  ),
  http.get("https://api.emporix.io/product/acme/products/p1", () =>
    HttpResponse.json({ id: "p1", name: "Widget" }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("createCore", () => {
  it("builds a working ClientContext via mk() that a service can use", async () => {
    const core = createCore({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(core.tenant).toBe("acme");
    const products = new ProductService(core.mk(ProductService.channel));
    const p = await products.get("p1", undefined, { kind: "service" });
    expect((p as { name?: string }).name).toBe("Widget");
  });

  it("exposes the non-service public surface", () => {
    const core = createCore({ tenant: "acme", credentials: { storefront: { clientId: "sf" } }, logger: false });
    expect(typeof core.setStorefrontContext).toBe("function");
    expect(typeof core.setLogLevel).toBe("function");
    expect(typeof core.getLogLevel).toBe("function");
    expect(typeof core.setCustomerTokenRefresher).toBe("function");
    expect(core.tokenProvider).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — module doesn't exist. `pnpm -F @viu/emporix-sdk test -- create-core` → FAIL.

### 2.2 Implement `createCore`

- [ ] **Step 3:** Create `packages/sdk/src/core/create-core.ts` (extracted verbatim from the current constructor infra + methods):

```ts
import { validateConfig, type EmporixConfig, type ResolvedConfig } from "./config";
import {
  DefaultTokenProvider,
  CustomerRefreshRegistry,
  type TokenProvider,
  type CustomerTokenRefresher,
} from "./auth";
import { HttpClient } from "./http";
import {
  LevelResolver,
  createConsoleLogger,
  createNoopLogger,
  type Logger,
  type LogLevel,
  type ServiceName,
  type LoggerObjectConfig,
} from "./logger";
import type { ClientContext } from "./context";
import { SDK_VERSION } from "../version";

/** The service-agnostic core shared by `EmporixClient` and `createEmporixClient`. */
export interface EmporixCore {
  readonly tenant: string;
  readonly config: ResolvedConfig;
  readonly tokenProvider: TokenProvider;
  setStorefrontContext(ctx: {
    currency?: string;
    siteCode?: string;
    targetLocation?: string;
    language?: string;
  }): void;
  setLogLevel(level: LogLevel, opts?: { service?: ServiceName; force?: boolean }): void;
  getLogLevel(service: ServiceName): LogLevel;
  setCustomerTokenRefresher(refresher: CustomerTokenRefresher | null): void;
  /** Internal: builds a per-service ClientContext (logger child + HttpClient). */
  mk(service: ServiceName): ClientContext;
}

/** Validates config and assembles the shared infrastructure (no services). */
export function createCore(config: EmporixConfig): EmporixCore {
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
  const resolver = new LevelResolver(loggerObj);
  const root =
    baseLogger ??
    createConsoleLogger(resolver, {
      sdk: "emporix",
      sdkVersion: SDK_VERSION,
      tenant: cfg.tenant,
    });

  const tokenProvider: TokenProvider = cfg.tokenProvider ?? new DefaultTokenProvider(cfg);
  const customerRefresh = new CustomerRefreshRegistry();
  const requestContext: { language?: string | undefined } = {
    language: cfg.credentials.storefront?.context?.language,
  };

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
      customerRefresh,
      requestContext,
    }),
  });

  return {
    tenant: cfg.tenant,
    config: cfg,
    tokenProvider,
    mk,
    setStorefrontContext(ctx) {
      if (ctx.language !== undefined) {
        requestContext.language = ctx.language || undefined;
      }
      const { language: _language, ...priceContext } = ctx;
      if (Object.keys(priceContext).length > 0) {
        tokenProvider.setAnonymousContext?.(priceContext);
      }
    },
    setLogLevel(level, opts = {}) {
      resolver.set(level, opts.service, opts.force ?? false);
    },
    getLogLevel(service) {
      return resolver.get(service);
    },
    setCustomerTokenRefresher(refresher) {
      customerRefresh.set(refresher);
    },
  };
}
```

- [ ] **Step 4: Run** `pnpm -F @viu/emporix-sdk test -- create-core` → pass.

### 2.3 Re-implement `EmporixClient` on `createCore`

- [ ] **Step 5:** In `packages/sdk/src/client.ts`:
  - Replace the infra block (`:131-176`) with `const core = createCore(config);` and assign `this.tenant = core.tenant; this.config = core.config; this.tokenProvider = core.tokenProvider;`. Store `this.#core = core;` (add `readonly #core: EmporixCore;` field; or a private `_core`). Keep the service instantiation block but build each via the static channel, e.g. `this.products = new ProductService(core.mk(ProductService.channel));` … and `this.segments = new SegmentService(core.mk(SegmentService.channel), { products: this.products, categories: this.categories });`.
  - Delete the now-unused imports that moved into `create-core.ts` (`validateConfig`, `DefaultTokenProvider`, `CustomerRefreshRegistry`, `HttpClient`, `LevelResolver`, `createConsoleLogger`, `createNoopLogger`, `Logger`/`LoggerObjectConfig` types, `SDK_VERSION`) **only if** no longer referenced in `client.ts`. Keep `type ServiceName`, `type LogLevel`, `type ClientContext`? `ClientContext` is no longer constructed here (core.mk returns it) — drop if unused. Add `import { createCore, type EmporixCore } from "./core/create-core";`.
  - Replace the four methods (`:238-273`) with delegations:

```ts
  setStorefrontContext(ctx: { currency?: string; siteCode?: string; targetLocation?: string; language?: string }): void {
    this.#core.setStorefrontContext(ctx);
  }
  setLogLevel(level: LogLevel, opts: { service?: ServiceName; force?: boolean } = {}): void {
    this.#core.setLogLevel(level, opts);
  }
  getLogLevel(service: ServiceName): LogLevel {
    return this.#core.getLogLevel(service);
  }
  setCustomerTokenRefresher(refresher: CustomerTokenRefresher | null): void {
    this.#core.setCustomerTokenRefresher(refresher);
  }
```

  Keep `import { type CustomerTokenRefresher } from "./core/auth";` and `type { LogLevel, ServiceName } from "./core/logger";`.

- [ ] **Step 6: Run the full SDK suite** `pnpm -F @viu/emporix-sdk test` → all 628 green (this is the proof the extraction is behavior-identical). `pnpm typecheck` → clean. `pnpm -r build` → builds.

- [ ] **Step 7: Commit:**

```bash
git add packages/sdk/src/core/create-core.ts packages/sdk/src/client.ts packages/sdk/tests/create-core.test.ts
git commit -m "refactor(sdk): extract createCore and reuse it in EmporixClient"
```

---

## Task 3: The `createEmporixClient` factory

**Files:**
- Create: `packages/sdk/src/create-emporix-client.ts`
- Modify: `packages/sdk/src/index.ts` (export `createEmporixClient`, `createCore`, `EmporixCore`)
- Test: `packages/sdk/tests/create-emporix-client.test.ts`

### 3.1 Failing test

- [ ] **Step 1:** Create `packages/sdk/tests/create-emporix-client.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { createEmporixClient } from "../src/create-emporix-client";
import { ProductService } from "../src/services/product";
import { CategoryService } from "../src/services/category";
import { SegmentService } from "../src/services/segment";
import { EmporixError } from "../src/core/errors";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({ access_token: "anon", token_type: "Bearer", expires_in: 3599, refresh_token: "rt", sessionId: "s" }),
  ),
  http.get("https://api.emporix.io/product/acme/products/p1", () => HttpResponse.json({ id: "p1", name: "Widget" })),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const config = { tenant: "acme", credentials: { storefront: { clientId: "sf" } }, logger: false as const };

describe("createEmporixClient", () => {
  it("builds only the requested services and they work like EmporixClient's", async () => {
    const client = createEmporixClient(config, { products: ProductService });
    expect(client.tenant).toBe("acme");
    const p = await client.products.get("p1", undefined, { kind: "anonymous" });
    expect((p as { name?: string }).name).toBe("Widget");
    // unrequested services are absent
    expect((client as Record<string, unknown>).carts).toBeUndefined();
  });

  it("wires SegmentService's product/category deps", () => {
    const client = createEmporixClient(config, {
      products: ProductService, categories: CategoryService, segments: SegmentService,
    });
    expect(client.segments).toBeInstanceOf(SegmentService);
    expect(client.products).toBeInstanceOf(ProductService);
  });

  it("throws when a dependent service is missing its deps", () => {
    expect(() => createEmporixClient(config, { segments: SegmentService })).toThrow(EmporixError);
    expect(() => createEmporixClient(config, { segments: SegmentService })).toThrow(/requires "products"/);
  });

  it("exposes the core public surface", () => {
    const client = createEmporixClient(config, { products: ProductService });
    expect(typeof client.setStorefrontContext).toBe("function");
    expect(client.tokenProvider).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — module doesn't exist. `pnpm -F @viu/emporix-sdk test -- create-emporix-client` → FAIL.

### 3.2 Implement the factory

- [ ] **Step 3:** Create `packages/sdk/src/create-emporix-client.ts` (imports **no** services):

```ts
import type { EmporixConfig } from "./core/config";
import type { ClientContext } from "./core/context";
import type { ServiceName } from "./core/logger";
import { EmporixError } from "./core/errors";
import { createCore, type EmporixCore } from "./core/create-core";

/** A service class the factory can instantiate: carries its channel + optional deps. */
export interface ServiceClass<I> {
  readonly channel: ServiceName;
  readonly deps?: readonly string[];
  new (ctx: ClientContext, deps?: Record<string, unknown>): I;
}

/**
 * Tree-shakeable client factory. Builds ONLY the service classes you pass —
 * imports no services itself, so a bundler drops every service you don't use.
 * `EmporixClient` remains the batteries-included default; reach for this when
 * bundle size matters. Dependent services (e.g. `segments`) require their deps
 * to be present in the map under their public names (`products`, `categories`).
 */
export function createEmporixClient<S extends Record<string, ServiceClass<unknown>>>(
  config: EmporixConfig,
  services: S,
): Omit<EmporixCore, "mk"> & { [K in keyof S]: InstanceType<S[K]> } {
  const { mk, ...core } = createCore(config);
  const built: Record<string, unknown> = {};
  const entries = Object.entries(services) as [string, ServiceClass<unknown>][];

  // Pass 1: dependency-free services.
  for (const [key, Svc] of entries) {
    if (!Svc.deps?.length) built[key] = new Svc(mk(Svc.channel));
  }
  // Pass 2: dependents (only `segments` today; deps are all dep-free, so two
  // passes suffice — a deeper graph would need a topological sort).
  for (const [key, Svc] of entries) {
    if (!Svc.deps?.length) continue;
    const deps: Record<string, unknown> = {};
    for (const dep of Svc.deps) {
      if (!(dep in built)) {
        throw new EmporixError(
          `createEmporixClient: "${key}" requires "${dep}" in the services map`,
        );
      }
      deps[dep] = built[dep];
    }
    built[key] = new Svc(mk(Svc.channel), deps);
  }

  return { ...core, ...built } as Omit<EmporixCore, "mk"> & {
    [K in keyof S]: InstanceType<S[K]>;
  };
}
```

(`mk` is destructured out so it is NOT exposed on the returned client — it stays an internal building block.)

- [ ] **Step 4:** In `packages/sdk/src/index.ts`, add: `export { createEmporixClient } from "./create-emporix-client";` and `export { createCore } from "./core/create-core";` and `export type { EmporixCore } from "./core/create-core";` and `export type { ServiceClass } from "./create-emporix-client";`.

- [ ] **Step 5: Run** `pnpm -F @viu/emporix-sdk test -- create-emporix-client` → pass; full suite → 628+ green; `pnpm typecheck` → clean.

- [ ] **Step 6: Commit:**

```bash
git add packages/sdk/src/create-emporix-client.ts packages/sdk/src/index.ts packages/sdk/tests/create-emporix-client.test.ts
git commit -m "feat(sdk): add tree-shakeable createEmporixClient factory"
```

---

## Task 4: Tree-shaking verification probe

**Files:**
- Create: `packages/sdk/scripts/check-treeshake.mjs`
- Modify: `packages/sdk/package.json` (add `check:treeshake` script)

This is the load-bearing proof the factory actually shrinks the bundle. It bundles a fixture that imports only `createEmporixClient` + two services and asserts unused services' unique runtime markers are absent.

- [ ] **Step 1:** Create `packages/sdk/scripts/check-treeshake.mjs`:

```js
import { build } from "esbuild";

// Fixture: a factory consumer that uses only products + carts.
const fixture = `
  import { createEmporixClient, ProductService, CartService } from "../dist/index.js";
  const c = createEmporixClient(
    { tenant: "t", credentials: { storefront: { clientId: "x" } }, logger: false },
    { products: ProductService, carts: CartService },
  );
  globalThis.__c = c;
`;

const result = await build({
  stdin: { contents: fixture, resolveDir: import.meta.dirname, loader: "js" },
  bundle: true,
  minify: true,
  format: "esm",
  treeShaking: true,
  write: false,
  logLevel: "silent",
});
const out = result.outputFiles[0].text;

// Unique endpoint substrings that appear ONLY in services NOT pulled by
// products/carts. If the factory tree-shakes, none may survive.
const forbidden = ["sepa-export", "reward-points", "/webhooks", "pick-pack", "ai-rag-indexer"];
const leaked = forbidden.filter((m) => out.includes(m));
if (leaked.length > 0) {
  console.error(`tree-shaking FAILED — unused service markers in bundle: ${leaked.join(", ")}`);
  process.exit(1);
}
// Sanity: the services we DID import must be present.
for (const m of ["/products/", "/carts"]) {
  if (!out.includes(m)) {
    console.error(`tree-shaking probe broken — expected marker "${m}" missing`);
    process.exit(1);
  }
}
console.log(`createEmporixClient tree-shakes: none of [${forbidden.join(", ")}] in the bundle (${(out.length / 1024).toFixed(1)} KB)`);
```

- [ ] **Step 2:** Add to `packages/sdk/package.json` `scripts`: `"check:treeshake": "node scripts/check-treeshake.mjs"`. Before running it, the dist must exist (`pnpm -F @viu/emporix-sdk build`).

- [ ] **Step 3: Run** `pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk check:treeshake` → prints the "tree-shakes" line, exit 0. If a `forbidden` marker turns out to also appear in products/carts' transitive imports (false positive), replace it with another unique-to-an-excluded-service substring (grep `packages/sdk/src/services/<excluded>.ts` for a path literal that no kept service uses) and note the swap.

- [ ] **Step 4: Commit:**

```bash
git add packages/sdk/scripts/check-treeshake.mjs packages/sdk/package.json
git commit -m "test(sdk): add tree-shaking probe for createEmporixClient"
```

---

## Task 5: Changeset, final verification, PR

- [ ] **Step 1:** Create `.changeset/create-emporix-client-factory.md`:

```md
---
"@viu/emporix-sdk": minor
---

add `createEmporixClient(config, services)` — a tree-shakeable, opt-in client factory that instantiates only the service classes you pass (e.g. `{ products: ProductService, carts: CartService }`), so bundlers drop every service you don't use. Service classes now carry static `channel`/`deps` metadata; `createCore(config)` exposes the shared infrastructure. `EmporixClient` is unchanged — it stays the batteries-included default that bundles everything — so this is purely additive.
```

- [ ] **Step 2: Verify:** `pnpm -F @viu/emporix-sdk test` (628 + new tests green), `pnpm -r build`, `pnpm typecheck` (clean), `pnpm -F @viu/emporix-sdk check:treeshake` (green), `pnpm changeset status` (sdk minor). Examples still compile.

- [ ] **Step 3: Commit + push:**

```bash
git add .changeset/create-emporix-client-factory.md
git commit -m "docs(repo): add changeset for createEmporixClient factory"
git push -u origin feat/create-emporix-client-factory
```

KNOWN ISSUE: the sandbox has no SSH identity — if push fails with `Permission denied (publickey)`, STOP and hand `! git push -u origin feat/create-emporix-client-factory` to the user; do not retry.

- [ ] **Step 4: PR** against `main`, title `feat(sdk): add tree-shakeable createEmporixClient factory`, body summarizing: the additive factory, the `createCore` extraction, the static metadata, the tree-shaking probe as proof, and that `EmporixClient` is unchanged (minor, non-breaking). End with the Claude Code attribution line.

---

## Self-review notes (done at plan time)

- **Spec coverage:** `createCore` extraction (spec §Architecture.1) → Task 2; static channel/deps metadata (spec §Architecture.2) → Task 1; factory module with mapped return type (spec §Architecture.3) → Task 3; `EmporixClient` re-implemented and unchanged (spec §Architecture.4) → Task 2.3 with the 628-test gate; tree-shaking verification (spec §Tree-shaking) → Task 4 probe; dep guard error (spec §Error handling) → Task 3 test + implementation; minor release (spec §Release) → Task 5. ✓
- **Behavior preservation:** Task 2 moves the constructor infra + methods verbatim into `createCore`; the full 628-test SDK suite is the regression net (Step 2.3-6). Method bodies are copied exactly (setStorefrontContext's language/price split, setLogLevel's `force ?? false`, etc.).
- **Tree-shaking correctness:** the factory and `createCore` import zero services; `EmporixClient` lives in its own module that imports all services, so only a consumer referencing `EmporixClient` pulls them. The Task-4 probe is the empirical proof; its `forbidden` markers have a documented swap path if a false positive appears.
- **Type consistency:** `EmporixCore` (Task 2) is consumed by `createEmporixClient` (Task 3) via `Omit<EmporixCore, "mk">`; `ServiceClass<I>` matches the `static channel`/`static deps` added in Task 1 and `SegmentService`'s `(ctx, deps)` constructor; `InstanceType<S[K]>` maps each passed class to its instance. ✓
- **Dep ordering:** only `SegmentService` has deps (on `products`+`categories`, both dep-free), so the two-pass build is correct; a deeper graph would need a topological sort — flagged inline in the factory comment and the plan.
- **Known execution risks flagged inline:** unused imports to prune in `client.ts` after the `createCore` extraction (Task 2.3 Step 5, "only if no longer referenced"); the tree-shake probe's potential false-positive markers + swap instruction (Task 4 Step 3).
