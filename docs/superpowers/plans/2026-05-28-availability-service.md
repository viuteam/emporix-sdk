# Availability Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `AvailabilityService` (`client.availability.get` / `.getMany`) plus `useAvailability` / `useAvailabilities` React hooks for site-aware product availability, with an opt-in `defaultAvailableOnNotFound` fallback.

**Architecture:** A flat service facade on `EmporixClient` mirroring `PriceService`: `get()` calls the single GET endpoint; `getMany()` calls the batch `POST .../search` endpoint (one request) and re-sorts to input order. Types come from a new committed OpenAPI spec via the existing `@hey-api/openapi-ts` codegen pipeline. React hooks wrap the service in `useQuery` (30s stale time), mirroring `useMatchPrices`.

**Tech Stack:** TypeScript, native `fetch` (via `HttpClient`), Vitest + MSW, `@tanstack/react-query` v5, `@hey-api/openapi-ts` (types-only), tsup, changesets.

**Branch:** `feat/availability-service` (already created; the design spec `docs/superpowers/specs/2026-05-28-availability-service-design.md` is already committed here).

**Reference spec:** `docs/superpowers/specs/2026-05-28-availability-service-design.md`.

---

### Task 1: Foundation — commitlint scope, OpenAPI spec, codegen, ServiceName

No automated test (infrastructure). Verified by `pnpm generate` output + `pnpm typecheck`.

**Files:**
- Modify: `commitlint.config.js`
- Create: `packages/sdk/specs/availability.yml`
- Create (generated): `packages/sdk/src/generated/availability/` (via `pnpm generate`)
- Modify: `packages/sdk/src/core/logger.ts:10-27` (`ServiceName` union)

- [ ] **Step 1: Allow the `availability` commit scope**

In `commitlint.config.js`, add `"availability"` to the `scope-enum` array (so `feat(availability): …` passes the husky `commit-msg` hook). The full new array:

```js
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      2,
      "always",
      ["repo", "release", "sdk", "react", "core", "customer", "product", "category", "cart", "checkout", "payment", "price", "media", "segment", "availability", "auth", "http", "logger", "deps", "docs", "examples"]
    ]
  }
};
```

- [ ] **Step 2: Add the trimmed OpenAPI spec**

Create `packages/sdk/specs/availability.yml` (faithful subset of the live Emporix Availability Service spec — schemas + the GET and search operations):

```yaml
openapi: 3.0.0
info:
  title: Availability Service
  version: 0.0.1
servers:
  - url: https://api.emporix.io
tags:
  - name: Availabilities
paths:
  /availability/{tenant}/availability/{productId}/{site}:
    get:
      tags: [Availabilities]
      operationId: getProductAvailability
      summary: Retrieve a product availability
      parameters:
        - { name: tenant, in: path, required: true, schema: { type: string } }
        - { name: productId, in: path, required: true, schema: { type: string } }
        - { name: site, in: path, required: true, schema: { type: string } }
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/AvailabilityWithBundle"
  /availability/{tenant}/availability/search:
    post:
      tags: [Availabilities]
      operationId: searchProductAvailabilities
      summary: Retrieve availabilities for specified products
      parameters:
        - { name: tenant, in: path, required: true, schema: { type: string } }
        - { name: site, in: query, required: false, schema: { type: string } }
        - { name: pageSize, in: query, required: false, schema: { type: number } }
        - { name: pageNumber, in: query, required: false, schema: { type: number } }
      requestBody:
        content:
          application/json:
            schema:
              type: array
              items: { type: string }
      responses:
        "200":
          description: OK
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/AvailabilityWithBundleList"
components:
  schemas:
    DistributionChannel:
      type: string
      enum: [ASSORTMENT, HOME_DELIVERY, PICKUP]
    Availability:
      type: object
      properties:
        id: { type: string }
        site: { type: string }
        stockLevel: { type: number }
        available: { type: boolean }
        productId: { type: string }
        vendorId: { type: string }
        popularity: { type: integer }
        distributionChannel: { $ref: "#/components/schemas/DistributionChannel" }
        mixins: { type: object, additionalProperties: true }
        metadata:
          type: object
          properties:
            createdAt: { type: string, format: date-time }
            modifiedAt: { type: string, format: date-time }
            mixins: { type: object, additionalProperties: { type: string } }
    AvailabilityWithBundle:
      type: object
      properties:
        id: { type: string }
        site: { type: string }
        stockLevel: { type: number }
        available: { type: boolean }
        productId: { type: string }
        vendorId: { type: string }
        popularity: { type: integer }
        distributionChannel: { $ref: "#/components/schemas/DistributionChannel" }
        bundleAvailabilities: { $ref: "#/components/schemas/AvailabilityList" }
        mixins: { type: object, additionalProperties: true }
        metadata:
          type: object
          properties:
            createdAt: { type: string, format: date-time }
            modifiedAt: { type: string, format: date-time }
            mixins: { type: object, additionalProperties: { type: string } }
    AvailabilityList:
      type: array
      items: { $ref: "#/components/schemas/Availability" }
    AvailabilityWithBundleList:
      type: array
      items: { $ref: "#/components/schemas/AvailabilityWithBundle" }
```

- [ ] **Step 3: Generate the types**

Run: `pnpm -F @viu/emporix-sdk generate`
Expected: prints `generated availability` (among the other already-committed specs) and writes `packages/sdk/src/generated/availability/index.ts` + `types.gen.ts` with the `// AUTO-GENERATED — do not edit` banner.

- [ ] **Step 4: Confirm codegen touched only the new dir**

Run: `git status --porcelain packages/sdk/src/generated`
Expected: only paths under `packages/sdk/src/generated/availability/` are new/modified. If any other `generated/*` dir shows changes, discard those with `git checkout -- packages/sdk/src/generated/<other>` (committed specs regenerate idempotently; unrelated churn is not part of this change).

- [ ] **Step 5: Verify the generated type names**

Run: `grep -E "export type (Availability|AvailabilityWithBundle|AvailabilityWithBundleList|DistributionChannel)" packages/sdk/src/generated/availability/types.gen.ts`
Expected: all four names appear (hey-api preserves schema names — same as `Match`/`MatchResponse` in `generated/price`). The service in Task 2 imports `AvailabilityWithBundle` from here.

- [ ] **Step 6: Add `availability` to the `ServiceName` union**

In `packages/sdk/src/core/logger.ts`, extend the union (currently ending `… | "sales-orders" | "http" | "auth";`). Add `| "availability"` before `"http"`:

```ts
export type ServiceName =
  | "customer"
  | "product"
  | "category"
  | "cart"
  | "checkout"
  | "payment"
  | "price"
  | "media"
  | "segment"
  | "site"
  | "session-context"
  | "customer-management"
  | "iam"
  | "orders"
  | "sales-orders"
  | "availability"
  | "http"
  | "auth";
```

- [ ] **Step 7: Typecheck**

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: passes (generated types compile; union widened).

- [ ] **Step 8: Commit**

```bash
git add commitlint.config.js packages/sdk/specs/availability.yml packages/sdk/src/generated/availability packages/sdk/src/core/logger.ts
git commit -m "$(cat <<'EOF'
chore(availability): add availability openapi spec and generated types

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `AvailabilityService.get()` (TDD)

**Files:**
- Create: `packages/sdk/src/services/availability.ts`
- Test: `packages/sdk/tests/services/availability.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/availability.test.ts` (harness copied from `tests/services/price.test.ts`; `get` cases only for now):

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { AvailabilityService } from "../../src/services/availability";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";
import { EmporixNotFoundError } from "../../src/core/errors";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon-tok", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
  http.post("https://api.emporix.io/oauth/token", () =>
    HttpResponse.json({ access_token: "svc-tok", token_type: "Bearer", expires_in: 3599 }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const SERVICE = { kind: "service" as const, credentials: "backend" };

function svc(): AvailabilityService {
  const cfg = {
    tenant: "acme", host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "availability" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io", provider: tokenProvider, logger,
    retry: { maxAttempts: 1 }, timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new AvailabilityService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

describe("AvailabilityService.get", () => {
  it("GETs the single endpoint with the anonymous token and returns the record", async () => {
    let authHeader: string | null = null;
    server.use(
      http.get("https://api.emporix.io/availability/acme/availability/p1/main", ({ request }) => {
        authHeader = request.headers.get("authorization");
        return HttpResponse.json({ id: "main:p1", productId: "p1", site: "main", available: true, stockLevel: 7 });
      }),
    );
    const r = await svc().get("p1", "main");
    expect(authHeader).toBe("Bearer anon-tok");
    expect(r.available).toBe(true);
    expect(r.stockLevel).toBe(7);
  });

  it("throws EmporixNotFoundError on 404 without defaultAvailableOnNotFound", async () => {
    server.use(
      http.get("https://api.emporix.io/availability/acme/availability/missing/main", () =>
        HttpResponse.json({ code: 404, message: "not found" }, { status: 404 }),
      ),
    );
    await expect(svc().get("missing", "main")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("returns a default available record on 404 when defaultAvailableOnNotFound is set", async () => {
    server.use(
      http.get("https://api.emporix.io/availability/acme/availability/missing/main", () =>
        HttpResponse.json({ code: 404, message: "not found" }, { status: 404 }),
      ),
    );
    const r = await svc().get("missing", "main", undefined, { defaultAvailableOnNotFound: true });
    expect(r).toEqual({ productId: "missing", site: "main", available: true });
  });

  it("re-auths and retries once on a 401 for a service AuthContext", async () => {
    let hits = 0;
    server.use(
      http.get("https://api.emporix.io/availability/acme/availability/p1/main", () => {
        hits += 1;
        if (hits === 1) return HttpResponse.json({ code: 401 }, { status: 401 });
        return HttpResponse.json({ id: "main:p1", productId: "p1", site: "main", available: true });
      }),
    );
    const r = await svc().get("p1", "main", SERVICE);
    expect(hits).toBe(2);
    expect(r.available).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk test -- availability`
Expected: FAIL — cannot resolve `../../src/services/availability` (module does not exist).

- [ ] **Step 3: Implement the service with `get()`**

Create `packages/sdk/src/services/availability.ts`:

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import { EmporixNotFoundError } from "../core/errors";
import type { AvailabilityWithBundle } from "../generated/availability";

/**
 * Site-aware product availability. Mirrors the Emporix Availability Service
 * `AvailabilityWithBundle` shape (the single-product GET and the batch search
 * both return the bundle-aware variant). There is no restock-date field.
 */
export type Availability = AvailabilityWithBundle;

/** Shared options for {@link AvailabilityService} reads. */
export interface AvailabilityOptions {
  /**
   * When `true`, a product with no availability record resolves to a default
   * `{ available: true }` instead of throwing (single `get`) / being marked
   * unavailable (`getMany`). Off by default — opt in for tenants that sell
   * without stock management.
   */
  defaultAvailableOnNotFound?: boolean;
}

const ANON: AuthContext = { kind: "anonymous" };

/**
 * Reads product availability per site. Default auth is anonymous (like
 * `PriceService.matchByContext`); pass a customer/raw/service context to use a
 * different token. Requires the `availability.availability_view` scope on
 * whichever token is used.
 */
export class AvailabilityService {
  constructor(private readonly ctx: ClientContext) {}

  /**
   * Single product. Resolves the availability record, or — when
   * `opts.defaultAvailableOnNotFound` is set — a default available record on 404.
   */
  async get(
    productId: string,
    siteCode: string,
    auth: AuthContext = ANON,
    opts: AvailabilityOptions = {},
  ): Promise<Availability> {
    try {
      return await this.ctx.http.request<Availability>({
        method: "GET",
        path: `/availability/${this.ctx.tenant}/availability/${encodeURIComponent(
          productId,
        )}/${encodeURIComponent(siteCode)}`,
        auth,
      });
    } catch (err) {
      if (err instanceof EmporixNotFoundError && opts.defaultAvailableOnNotFound) {
        return { productId, site: siteCode, available: true };
      }
      throw err;
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk test -- availability`
Expected: PASS (4 `get` tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/availability.ts packages/sdk/tests/services/availability.test.ts
git commit -m "$(cat <<'EOF'
feat(availability): add AvailabilityService.get with notFound default

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `AvailabilityService.getMany()` (TDD)

**Files:**
- Modify: `packages/sdk/src/services/availability.ts` (add `getMany`)
- Test: `packages/sdk/tests/services/availability.test.ts` (add a `getMany` describe block)

- [ ] **Step 1: Write the failing test**

Append to `packages/sdk/tests/services/availability.test.ts` (after the existing `describe` block):

```ts
describe("AvailabilityService.getMany", () => {
  it("POSTs the id array to /search with site + pageSize and preserves input order", async () => {
    let body: unknown = null;
    let query: URLSearchParams | null = null;
    server.use(
      http.post("https://api.emporix.io/availability/acme/availability/search", async ({ request }) => {
        body = await request.json();
        query = new URL(request.url).searchParams;
        // Returned out of order on purpose:
        return HttpResponse.json([
          { id: "main:p3", productId: "p3", site: "main", available: true },
          { id: "main:p1", productId: "p1", site: "main", available: true, stockLevel: 2 },
        ]);
      }),
    );
    const r = await svc().getMany(["p1", "p2", "p3"], "main");
    expect(body).toEqual(["p1", "p2", "p3"]);
    expect((query as URLSearchParams | null)?.get("site")).toBe("main");
    expect((query as URLSearchParams | null)?.get("pageSize")).toBe("3");
    expect(r.map((a) => a.productId)).toEqual(["p1", "p2", "p3"]); // input order
    expect(r[0]?.stockLevel).toBe(2);
    expect(r[1]).toEqual({ productId: "p2", site: "main", available: false }); // missing → unavailable
  });

  it("marks missing products available when defaultAvailableOnNotFound is set", async () => {
    server.use(
      http.post("https://api.emporix.io/availability/acme/availability/search", () =>
        HttpResponse.json([{ id: "main:p1", productId: "p1", site: "main", available: true }]),
      ),
    );
    const r = await svc().getMany(["p1", "p2"], "main", undefined, { defaultAvailableOnNotFound: true });
    expect(r[1]).toEqual({ productId: "p2", site: "main", available: true });
  });

  it("returns [] without making a request for an empty id list", async () => {
    let called = false;
    server.use(
      http.post("https://api.emporix.io/availability/acme/availability/search", () => {
        called = true;
        return HttpResponse.json([]);
      }),
    );
    const r = await svc().getMany([], "main");
    expect(r).toEqual([]);
    expect(called).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk test -- availability`
Expected: FAIL — `svc(...).getMany is not a function`.

- [ ] **Step 3: Implement `getMany`**

Add this method to the `AvailabilityService` class in `packages/sdk/src/services/availability.ts` (after `get`):

```ts
  /**
   * Batch read via `POST .../availability/search` (one request). Products with
   * no availability record are absent from the response; each is synthesized as
   * `{ available: false }` (or `{ available: true }` when
   * `opts.defaultAvailableOnNotFound` is set). The result preserves input order
   * and length. An empty `productIds` resolves to `[]` without a request.
   */
  async getMany(
    productIds: string[],
    siteCode: string,
    auth: AuthContext = ANON,
    opts: AvailabilityOptions = {},
  ): Promise<Availability[]> {
    if (productIds.length === 0) return [];
    const found = await this.ctx.http.request<Availability[]>({
      method: "POST",
      path: `/availability/${this.ctx.tenant}/availability/search`,
      auth,
      query: { site: siteCode, pageSize: productIds.length },
      body: productIds,
    });
    const byId = new Map<string, Availability>();
    for (const a of found) if (a.productId) byId.set(a.productId, a);
    return productIds.map(
      (id) =>
        byId.get(id) ?? {
          productId: id,
          site: siteCode,
          available: Boolean(opts.defaultAvailableOnNotFound),
        },
    );
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk test -- availability`
Expected: PASS (all `get` + `getMany` tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/availability.ts packages/sdk/tests/services/availability.test.ts
git commit -m "$(cat <<'EOF'
feat(availability): add batch getMany via search endpoint

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Wire into the client + subpath export

No new unit test (covered by typecheck/build + a one-line client assertion). 

**Files:**
- Create: `packages/sdk/src/availability.ts` (subpath barrel)
- Modify: `packages/sdk/src/client.ts` (import, field, construct)
- Modify: `packages/sdk/src/index.ts` (re-export barrel)
- Modify: `packages/sdk/tsup.config.ts` (entry)
- Modify: `packages/sdk/package.json` (exports map)

- [ ] **Step 1: Create the subpath barrel**

Create `packages/sdk/src/availability.ts`:

```ts
export * from "./services/availability";
```

- [ ] **Step 2: Import + field + construct in the client**

In `packages/sdk/src/client.ts`:

Add the import next to the other service imports (after the `OrdersService` import line):

```ts
import { AvailabilityService } from "./services/availability";
```

Add the readonly field (after `readonly salesOrders: SalesOrdersService;`):

```ts
  readonly availability: AvailabilityService;
```

Construct it in the constructor (after `this.salesOrders = new SalesOrdersService(mk("sales-orders"));`):

```ts
    this.availability = new AvailabilityService(mk("availability"));
```

- [ ] **Step 3: Re-export from the main barrel**

In `packages/sdk/src/index.ts`, add after the `export * from "./orders";` line:

```ts
export * from "./availability";
```

- [ ] **Step 4: Add the tsup entry**

In `packages/sdk/tsup.config.ts`, add `"src/availability.ts",` to the `entry` array (after `"src/orders.ts",`).

- [ ] **Step 5: Add the package.json subpath export**

In `packages/sdk/package.json`, add this entry to `exports` (after the `"./orders"` block):

```json
    "./availability": {
      "types": "./dist/availability.d.ts",
      "import": "./dist/availability.js",
      "require": "./dist/availability.cjs"
    }
```

- [ ] **Step 6: Build the SDK**

Run: `pnpm -F @viu/emporix-sdk build`
Expected: succeeds; `packages/sdk/dist/availability.js`, `.cjs`, `.d.ts` are emitted.

- [ ] **Step 7: Verify the client exposes the service**

Run: `node -e "import('@viu/emporix-sdk').then(m => { const c = new m.EmporixClient({ tenant: 'acme', credentials: { backend: { clientId: 'b', secret: 's' }, storefront: { clientId: 'sf' } }, logger: false }); console.log(typeof c.availability.get, typeof c.availability.getMany); })"`
Expected: prints `function function`.

- [ ] **Step 8: Typecheck the whole repo**

Run: `pnpm typecheck`
Expected: passes (the subpath barrel + client wiring compile; examples still typecheck against the freshly built dist).

- [ ] **Step 9: Commit**

```bash
git add packages/sdk/src/availability.ts packages/sdk/src/client.ts packages/sdk/src/index.ts packages/sdk/tsup.config.ts packages/sdk/package.json
git commit -m "$(cat <<'EOF'
feat(availability): expose client.availability and ./availability subpath

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: React hooks `useAvailability` / `useAvailabilities` (TDD)

The React package resolves `@viu/emporix-sdk` to its built `dist/`, so the SDK must be built (Task 4 Step 6) before these tests run. If you skipped it, run `pnpm -F @viu/emporix-sdk build` first.

**Files:**
- Create: `packages/react/src/hooks/use-availability.ts`
- Create: `packages/react/src/hooks/use-availabilities.ts`
- Modify: `packages/react/src/hooks/index.ts`
- Modify: `packages/react/src/index.ts`
- Test: `packages/react/tests/use-availability.test.tsx`
- Test: `packages/react/tests/use-availabilities.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/react/tests/use-availability.test.tsx` (harness mirrors `tests/use-match-prices.test.tsx`):

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useAvailability } from "../src/hooks/use-availability";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "a", token_type: "Bearer", expires_in: 3600, refresh_token: "r", sessionId: "s",
    }),
  ),
  http.get("https://api.emporix.io/availability/viu/availability/p1/main", () =>
    HttpResponse.json({ id: "main:p1", productId: "p1", site: "main", available: true, stockLevel: 5 }),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap() {
  const client = new EmporixClient({
    tenant: "viu",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={createMemoryStorage()} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
}

describe("useAvailability", () => {
  it("resolves availability for a product + site", async () => {
    const { result } = renderHook(() => useAvailability("p1", "main"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.available).toBe(true);
    expect(result.current.data?.stockLevel).toBe(5);
  });

  it("is disabled when productId or siteCode is empty", () => {
    const { result } = renderHook(() => useAvailability("", "main"), { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe("idle");
  });
});
```

Create `packages/react/tests/use-availabilities.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useAvailabilities } from "../src/hooks/use-availabilities";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "a", token_type: "Bearer", expires_in: 3600, refresh_token: "r", sessionId: "s",
    }),
  ),
  http.post("https://api.emporix.io/availability/viu/availability/search", () =>
    HttpResponse.json([{ id: "main:p1", productId: "p1", site: "main", available: true }]),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap() {
  const client = new EmporixClient({
    tenant: "viu",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={createMemoryStorage()} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
}

describe("useAvailabilities", () => {
  it("resolves a batch in input order, marking missing products unavailable", async () => {
    const { result } = renderHook(() => useAvailabilities(["p1", "p2"], "main"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((a) => a.productId)).toEqual(["p1", "p2"]);
    expect(result.current.data?.[1]?.available).toBe(false);
  });

  it("is disabled for an empty id list", () => {
    const { result } = renderHook(() => useAvailabilities([], "main"), { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe("idle");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -F @viu/emporix-sdk-react test -- availab`
Expected: FAIL — cannot resolve `../src/hooks/use-availability` / `use-availabilities`.

- [ ] **Step 3: Implement `useAvailability`**

Create `packages/react/src/hooks/use-availability.ts`:

```ts
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { auth, type AuthContext, type Availability } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";

const AVAILABILITY_STALE_TIME = 30_000; // 30s — stock changes, but not per render.

export interface UseAvailabilityOptions {
  enabled?: boolean;
  customerToken?: string | null;
  defaultAvailableOnNotFound?: boolean;
}

/**
 * Reads availability for one product on one site via `availability.get`.
 * Defaults to the anonymous token; pass `customerToken` for a customer context.
 */
export function useAvailability(
  productId: string,
  siteCode: string,
  options: UseAvailabilityOptions = {},
): UseQueryResult<Availability> {
  const { client } = useEmporix();
  const ctx: AuthContext = options.customerToken
    ? auth.customer(options.customerToken)
    : auth.anonymous();
  return useQuery({
    queryKey: [
      "emporix",
      "availability",
      {
        tenant: client.tenant,
        productId,
        siteCode,
        anon: !options.customerToken,
        defaultAvailableOnNotFound: options.defaultAvailableOnNotFound ?? false,
      },
    ],
    enabled: (options.enabled ?? true) && Boolean(productId) && Boolean(siteCode),
    queryFn: () =>
      client.availability.get(productId, siteCode, ctx, {
        defaultAvailableOnNotFound: options.defaultAvailableOnNotFound,
      }),
    staleTime: AVAILABILITY_STALE_TIME,
  });
}
```

- [ ] **Step 4: Implement `useAvailabilities`**

Create `packages/react/src/hooks/use-availabilities.ts`:

```ts
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { auth, type AuthContext, type Availability } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";

const AVAILABILITY_STALE_TIME = 30_000; // 30s — stock changes, but not per render.

export interface UseAvailabilitiesOptions {
  enabled?: boolean;
  customerToken?: string | null;
  defaultAvailableOnNotFound?: boolean;
}

/**
 * Reads availability for many products on one site via `availability.getMany`
 * (a single batch request). Returns records in input order; missing products
 * are `{ available: false }` (or `{ available: true }` with
 * `defaultAvailableOnNotFound`).
 */
export function useAvailabilities(
  productIds: string[],
  siteCode: string,
  options: UseAvailabilitiesOptions = {},
): UseQueryResult<Availability[]> {
  const { client } = useEmporix();
  const ctx: AuthContext = options.customerToken
    ? auth.customer(options.customerToken)
    : auth.anonymous();
  return useQuery({
    queryKey: [
      "emporix",
      "availabilities",
      {
        tenant: client.tenant,
        productIds,
        siteCode,
        anon: !options.customerToken,
        defaultAvailableOnNotFound: options.defaultAvailableOnNotFound ?? false,
      },
    ],
    enabled: (options.enabled ?? true) && productIds.length > 0 && Boolean(siteCode),
    queryFn: () =>
      client.availability.getMany(productIds, siteCode, ctx, {
        defaultAvailableOnNotFound: options.defaultAvailableOnNotFound,
      }),
    staleTime: AVAILABILITY_STALE_TIME,
  });
}
```

- [ ] **Step 5: Export from the hooks barrel**

In `packages/react/src/hooks/index.ts`, add after the `useUpdateSalesOrder` export block:

```ts
export { useAvailability } from "./use-availability";
export type { UseAvailabilityOptions } from "./use-availability";
export { useAvailabilities } from "./use-availabilities";
export type { UseAvailabilitiesOptions } from "./use-availabilities";
```

- [ ] **Step 6: Export from the package barrel**

In `packages/react/src/index.ts`, add `useAvailability,` and `useAvailabilities,` to the big `export { … } from "./hooks/index";` list (after `useUpdateSalesOrder,`). Then add their option types to the type re-export — change the existing line:

```ts
export type { CompanySwitcherApi, UseMyOrdersOptions, UseMyOrdersInfiniteOptions } from "./hooks/index";
```

to:

```ts
export type {
  CompanySwitcherApi,
  UseMyOrdersOptions,
  UseMyOrdersInfiniteOptions,
  UseAvailabilityOptions,
  UseAvailabilitiesOptions,
} from "./hooks/index";
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm -F @viu/emporix-sdk-react test -- availab`
Expected: PASS (4 tests across both files).

- [ ] **Step 8: Typecheck**

Run: `pnpm -F @viu/emporix-sdk-react typecheck`
Expected: passes.

- [ ] **Step 9: Commit**

```bash
git add packages/react/src/hooks/use-availability.ts packages/react/src/hooks/use-availabilities.ts packages/react/src/hooks/index.ts packages/react/src/index.ts packages/react/tests/use-availability.test.tsx packages/react/tests/use-availabilities.test.tsx
git commit -m "$(cat <<'EOF'
feat(react): add useAvailability and useAvailabilities hooks

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Docs

**Files:**
- Create: `docs/availability.md`
- Modify: `packages/sdk/README.md` (Subpath exports list + a short Availability section)

- [ ] **Step 1: Write `docs/availability.md`**

Create `docs/availability.md`:

```markdown
# Availability

Site-aware product availability via the Emporix Availability Service. Exposed as
`client.availability` (SDK) and the `useAvailability` / `useAvailabilities` hooks
(React).

## Scope & auth

Reads require the `availability.availability_view` scope. Calls default to the
anonymous (storefront) token — which works only if your storefront client carries
that scope (the same assumption price matching makes). Pass `auth.service()` for a
server-side service token, or a customer token for a customer context.

There is **no restock-date / availability-date field** in the API. A record
carries `available`, optional `stockLevel`, `productId`, `site`, and (for bundles)
`bundleAvailabilities`.

## SDK

```ts
// Single product
const a = await client.availability.get("PRODUCT-1", "main");
if (a.available) render(a.stockLevel);

// Tenants without stock management: treat "no record" as available
const a2 = await client.availability.get("PRODUCT-1", "main", auth.anonymous(), {
  defaultAvailableOnNotFound: true,
});

// Batch — one request, result is in input order
const list = await client.availability.getMany(["P1", "P2", "P3"], "main");
// Missing products come back as { available: false } unless
// defaultAvailableOnNotFound is set (then { available: true }).
```

`getMany` issues a single `POST /availability/{tenant}/availability/search`. The
result always has the same length and order as `productIds`.

## React

```tsx
import { useAvailability, useAvailabilities } from "@viu/emporix-sdk-react";

function StockBadge({ productId, site }: { productId: string; site: string }) {
  const { data } = useAvailability(productId, site);
  return <span>{data?.available ? "In stock" : "Sold out"}</span>;
}

function Grid({ ids, site }: { ids: string[]; site: string }) {
  const { data } = useAvailabilities(ids, site, { defaultAvailableOnNotFound: true });
  return <>{data?.map((a) => <Tile key={a.productId} a={a} />)}</>;
}
```

Both hooks default to the anonymous token (pass `customerToken` to override),
use a 30s stale time, and accept `defaultAvailableOnNotFound`.
```

- [ ] **Step 2: Link from the SDK README**

In `packages/sdk/README.md`, add an `Availability` section after the `Media` section (before `## Subpath exports`):

```markdown
## Availability

`sdk.availability` reads site-aware product availability: `get(productId, siteCode)`
for one product and `getMany(productIds, siteCode)` for a batch (single
`POST .../search` request, result in input order). The opt-in
`defaultAvailableOnNotFound` returns `{ available: true }` for products without a
stock record. There is no restock-date field. See [`../../docs/availability.md`](../../docs/availability.md).
```

Then add `./availability` to the `## Subpath exports` paragraph list (append `, ./availability` after `./customer-groups`).

- [ ] **Step 3: Verify the docs links resolve**

Run: `test -f docs/availability.md && grep -q "availability" packages/sdk/README.md && echo OK`
Expected: prints `OK`.

- [ ] **Step 4: Commit**

```bash
git add docs/availability.md packages/sdk/README.md
git commit -m "$(cat <<'EOF'
docs(availability): document availability service and hooks

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Changeset

**Files:**
- Create: `.changeset/availability-service.md`

- [ ] **Step 1: Write the changeset**

Create `.changeset/availability-service.md` (both packages explicitly `minor` so the React peer-dependent is not force-majored; `linked` keeps them equal → both `2.0.0 → 2.1.0`):

```md
---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add AvailabilityService (`client.availability.get` / `.getMany`) and the
`useAvailability` / `useAvailabilities` React hooks for site-aware product
availability. `getMany` uses the batch `POST .../search` endpoint and returns
results in input order; an opt-in `defaultAvailableOnNotFound` treats products
with no stock record as available. New `@viu/emporix-sdk/availability` subpath export.
```

- [ ] **Step 2: Verify the changeset is well-formed**

Run: `pnpm changeset status`
Expected: lists `@viu/emporix-sdk` and `@viu/emporix-sdk-react` as `minor`.

- [ ] **Step 3: Commit**

```bash
git add .changeset/availability-service.md
git commit -m "$(cat <<'EOF'
chore(release): add changeset for availability service

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Final verification (before finishing)

- [ ] Run the full unit suite: `pnpm -r test` — all green.
- [ ] Run repo typecheck: `pnpm typecheck` — green.
- [ ] Run lint: `pnpm lint` — green.
- [ ] Then invoke **superpowers:finishing-a-development-branch** to verify tests, present the merge/PR/keep/discard options, and execute the choice.

## Notes for the implementer

- The SDK service unit tests construct the service directly (no `EmporixClient`),
  so Tasks 2–3 don't depend on Task 4 wiring. The React tests (Task 5) **do**
  depend on a built SDK `dist/` — build after Task 4.
- `pnpm -r test` is configured with coverage in the SDK package; that's expected.
- Do not stage the pre-existing modified files under `examples/next-app-router/`
  (`next-env.d.ts`, `tsconfig*.json`, `tsbuildinfo`) — they are unrelated build
  artifacts present before this branch.
```

