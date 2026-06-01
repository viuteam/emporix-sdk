# Tax Service Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Emporix **Tax Service** as a single server-side core SDK service, `client.taxes`, covering full CRUD over per-location tax configurations plus the net/gross tax-calculation command.

**Architecture:** Types are generated from the upstream OpenAPI via the existing `@hey-api/openapi-ts` pipeline; a thin public-types module (`tax-types.ts`) re-exports stable public names over the generated ones. One service class `TaxService` mirrors the upstream service, defaulting to the service (clientCredentials) token like `fee`/`schema`/`media`. It is wired onto `EmporixClient` exactly like the other services. No React binding.

**Tech Stack:** TypeScript, Vitest + MSW (Node), `@hey-api/openapi-ts`, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-06-01-tax-service-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/sdk/scripts/fetch-specs.ts` | add the `tax-service` spec URL |
| `packages/sdk/specs/tax-service.yml` | fetched OpenAPI (committed artifact) |
| `packages/sdk/src/generated/tax-service/{index.ts,types.gen.ts}` | generated types (committed artifact) |
| `packages/sdk/src/services/tax-types.ts` | public type aliases |
| `packages/sdk/src/services/tax.ts` | `TaxService` |
| `packages/sdk/src/tax.ts` | one-line facade re-export |
| `packages/sdk/src/core/logger.ts` | add `"tax"` to `ServiceName` |
| `packages/sdk/src/client.ts` | construct + expose `taxes` |
| `packages/sdk/src/index.ts` | re-export the facade |
| `packages/sdk/tests/services/tax-types.test.ts` | type-level tests |
| `packages/sdk/tests/services/tax.test.ts` | MSW tests |
| `packages/sdk/tests/services/tax-wiring.test.ts` | client wiring test |
| `docs/tax.md` | usage doc |
| `CLAUDE.md` | service-list update |
| `.changeset/tax-service.md` | release entry |

All commands run from the repo root: `/Users/dominic.fritschi/projects/viu/emporix-sdk`.

**Branch:** create `feat/tax-service` off current `main` before Task 1 (the spec + plan docs already exist in the working tree; commit them as the branch's first commit, mirroring prior services):
```bash
git checkout main && git pull
git checkout -b feat/tax-service
git add docs/superpowers/specs/2026-06-01-tax-service-design.md docs/superpowers/plans/2026-06-01-tax-service.md
git commit -m "docs(sdk): add tax service design spec and plan"
```

---

## Task 1: Generate Tax Service types (codegen)

**Files:**
- Modify: `packages/sdk/scripts/fetch-specs.ts`
- Create (generated): `packages/sdk/specs/tax-service.yml`, `packages/sdk/src/generated/tax-service/{index.ts,types.gen.ts}`

- [ ] **Step 1: Add the spec entry**

In `packages/sdk/scripts/fetch-specs.ts`, add to the `SPECS` object (after the `price` entry, keeping the prices-and-taxes group together):

```ts
  "tax-service": `${BASE}/prices-and-taxes/tax-service/api-reference/api.yml`,
```

(URL verified live → HTTP 200, 40 KB.)

- [ ] **Step 2: Fetch + generate**

```bash
pnpm -F @viu/emporix-sdk fetch:specs
pnpm -F @viu/emporix-sdk generate
```
Expected: console prints `fetched tax-service (...bytes)` and the generate step writes `src/generated/tax-service/`.

- [ ] **Step 3: Verify the generated type names**

```bash
grep -nE "^export type " packages/sdk/src/generated/tax-service/types.gen.ts
```
Record the exact name for each role in a scratch note for Task 2:
- tax config read shape (has `locationCode`, `taxClasses`) → e.g. `TaxRetrieval`
- tax config write shape (has `location`, `taxClasses`) → e.g. `TaxCreation` / `TaxUpdate`
- POST response (has only `locationCode`) → e.g. `TaxCreationResponse`
- tax class (has `code`, `rate`, `order`, `isDefault`) → e.g. `TaxClass`
- calculation request (has `input`) → e.g. `TaxCalculationRequest`
- calculation response (has `output`) → e.g. `TaxCalculationResponse`

Also confirm the PUT-update response shape (full config vs 204) and whether `name`/`description` are `string | Record<string,string>`:
```bash
grep -nE "locationCode|taxClasses|output|net|gross" packages/sdk/src/generated/tax-service/types.gen.ts | head
```
If a request/response schema is **inlined** (no named export), define that public type structurally in Task 2 (note which ones).

- [ ] **Step 4: Keep the change focused**

Run `git status --short`. If `fetch:specs`/`generate` touched unrelated `specs/*.yml` or `src/generated/*` files (upstream drift), restore them:
```bash
git restore packages/sdk/specs packages/sdk/src/generated
git restore --staged packages/sdk/specs packages/sdk/src/generated 2>/dev/null || true
```
Then re-run Step 2 and stage only the `tax-service` paths. (If `git status` showed only the new `tax-service` files, skip this step.)

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/scripts/fetch-specs.ts packages/sdk/specs/tax-service.yml packages/sdk/src/generated/tax-service
git commit -m "feat(sdk): generate tax service types"
```

---

## Task 2: Public types module

**Files:**
- Create: `packages/sdk/src/services/tax-types.ts`
- Test: `packages/sdk/tests/services/tax-types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/tax-types.test.ts`:

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  TaxClass,
  TaxConfig,
  TaxConfigInput,
  TaxConfigCreated,
  TaxCalculationRequest,
  TaxCalculationResult,
} from "../../src/services/tax-types";

describe("tax types", () => {
  it("TaxConfig exposes locationCode and a taxClasses array", () => {
    const c: TaxConfig = { locationCode: "DE", taxClasses: [] };
    expectTypeOf(c.locationCode).toEqualTypeOf<string>();
    expectTypeOf(c.taxClasses).toBeArray();
  });

  it("TaxClass carries code and optional rate", () => {
    const t: TaxClass = { code: "STANDARD", rate: 19 };
    expectTypeOf(t.code).toEqualTypeOf<string>();
  });

  it("TaxConfigInput accepts a location and tax classes", () => {
    const i: TaxConfigInput = { location: { countryCode: "DE" }, taxClasses: [] };
    expectTypeOf(i.taxClasses).toBeArray();
  });

  it("TaxConfigCreated returns the locationCode", () => {
    const r: TaxConfigCreated = { locationCode: "DE" };
    expectTypeOf(r.locationCode).toEqualTypeOf<string>();
  });

  it("TaxCalculationRequest holds an input; result exposes output", () => {
    const req: TaxCalculationRequest = {
      input: { targetLocation: { countryCode: "DE" }, price: 100 },
    };
    expectTypeOf(req.input.price).toEqualTypeOf<number>();
    const res: TaxCalculationResult = { output: { net: 100, gross: 119, tax: 19 } };
    expectTypeOf(res.output?.gross).toEqualTypeOf<number | undefined>();
  });
});
```

> **If Task 1 reported different generated shapes** (e.g. `name` typed only as
> `Record<string,string>`, `price`/`rate` optional, or an inlined calculation
> input), adjust the `expectTypeOf` lines so they match the real public contract.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/tax-types.test.ts`
Expected: runtime PASS but typecheck FAIL (the `import type` is erased at runtime). Confirm the real failure:
```bash
pnpm -F @viu/emporix-sdk exec tsc --noEmit 2>&1 | grep tax-types
```
Expected: `Cannot find module '../../src/services/tax-types'`.

- [ ] **Step 3: Write the types module**

Create `packages/sdk/src/services/tax-types.ts`. **Replace each `Gen*` import name with the actual generated name from Task 1, Step 3.** For any inlined schema, keep the structural definition instead of the alias.

```ts
import type {
  TaxRetrieval as GenTaxConfig,
  TaxCreation as GenTaxConfigInput,
  TaxCreationResponse as GenTaxConfigCreated,
  TaxClass as GenTaxClass,
  TaxCalculationRequest as GenTaxCalculationRequest,
  TaxCalculationResponse as GenTaxCalculationResult,
} from "../generated/tax-service";

/** One tax class within a configuration. */
export type TaxClass = GenTaxClass;
/** A per-location tax configuration (read shape). */
export type TaxConfig = GenTaxConfig;
/** Write shape for create/update (`metadata.version` required on update). */
export type TaxConfigInput = GenTaxConfigInput;
/** POST `/taxes` response — only the created `{ locationCode }`. */
export type TaxConfigCreated = GenTaxConfigCreated;
/** Body for `calculateTax` (`{ commandUuid?, input }`). */
export type TaxCalculationRequest = GenTaxCalculationRequest;
/** Result of `calculateTax` — carries `output` with net/gross/tax. */
export type TaxCalculationResult = GenTaxCalculationResult;
```

If the generated names do not map cleanly, fall back to defining that single
type structurally (matching the spec's "Public types" section), e.g.:

```ts
export interface TaxClass {
  code: string;
  name?: string | Record<string, string>;
  description?: string | Record<string, string>;
  order?: number;
  rate?: number;
  isDefault?: boolean;
}
export interface TaxConfig {
  locationCode: string;
  location?: { countryCode: string };
  taxClasses: TaxClass[];
  metadata?: { version?: number; createdAt?: string; modifiedAt?: string };
}
export interface TaxConfigInput {
  location: { countryCode: string };
  taxClasses: TaxClass[];
  metadata?: { version?: number };
}
export interface TaxConfigCreated { locationCode: string }
export interface TaxCalculationInput {
  sourceLocation?: { countryCode: string };
  sourceTaxClass?: string;
  targetLocation: { countryCode: string };
  targetTaxClass?: string;
  includesTax?: boolean;
  price: number;
}
export interface TaxCalculationRequest { commandUuid?: string; input: TaxCalculationInput }
export interface TaxCalculationResult {
  commandUuid?: string;
  input?: TaxCalculationInput;
  output?: { net?: number; gross?: number; tax?: number; appliedRate?: number };
}
```

- [ ] **Step 4: Run test + typecheck to verify they pass**

```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/tax-types.test.ts
pnpm -F @viu/emporix-sdk typecheck
```
Expected: test PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/tax-types.ts packages/sdk/tests/services/tax-types.test.ts
git commit -m "feat(sdk): add tax service public types"
```

---

## Task 3: TaxService

**Files:**
- Create: `packages/sdk/src/services/tax.ts`, `packages/sdk/src/tax.ts`
- Test: `packages/sdk/tests/services/tax.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/tax.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { TaxService } from "../../src/services/tax";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { EmporixNotFoundError } from "../../src/core/errors";
import { MemoryLogger } from "../helpers/memory-logger";

const server = setupServer(
  http.post("https://api.emporix.io/oauth/token", () =>
    HttpResponse.json({ access_token: "svc-tok", token_type: "Bearer", expires_in: 3599 }),
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "tax" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new TaxService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/tax/acme";

describe("TaxService", () => {
  it("listTaxConfigs GETs the array with a service token", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(`${BASE}/taxes`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json([{ locationCode: "DE", taxClasses: [] }]);
      }),
    );
    const out = await svc().listTaxConfigs();
    expect(seenAuth).toBe("Bearer svc-tok");
    expect(out).toHaveLength(1);
    expect(out[0]?.locationCode).toBe("DE");
  });

  it("getTaxConfig fetches one by location code", async () => {
    server.use(
      http.get(`${BASE}/taxes/DE`, () =>
        HttpResponse.json({ locationCode: "DE", taxClasses: [{ code: "STD", rate: 19 }] }),
      ),
    );
    const c = await svc().getTaxConfig("DE");
    expect(c.locationCode).toBe("DE");
    expect(c.taxClasses[0]?.code).toBe("STD");
  });

  it("getTaxConfig throws EmporixNotFoundError on 404", async () => {
    server.use(
      http.get(`${BASE}/taxes/XX`, () =>
        HttpResponse.json({ status: 404, message: "not found" }, { status: 404 }),
      ),
    );
    await expect(svc().getTaxConfig("XX")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("createTaxConfig POSTs the input and returns { locationCode }", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/taxes`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ locationCode: "DE" }, { status: 201 });
      }),
    );
    const res = await svc().createTaxConfig({
      location: { countryCode: "DE" },
      taxClasses: [{ code: "STD", rate: 19 }],
    } as never);
    expect(body).toEqual({ location: { countryCode: "DE" }, taxClasses: [{ code: "STD", rate: 19 }] });
    expect(res.locationCode).toBe("DE");
  });

  it("updateTaxConfig PUTs to the location code", async () => {
    let body: unknown = null;
    server.use(
      http.put(`${BASE}/taxes/DE`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ locationCode: "DE", taxClasses: [] });
      }),
    );
    const c = await svc().updateTaxConfig("DE", {
      location: { countryCode: "DE" },
      taxClasses: [],
      metadata: { version: 2 },
    } as never);
    expect((body as { metadata: { version: number } }).metadata.version).toBe(2);
    expect(c?.locationCode).toBe("DE");
  });

  it("deleteTaxConfig DELETEs and resolves to void", async () => {
    server.use(
      http.delete(`${BASE}/taxes/DE`, () => new HttpResponse(null, { status: 204 })),
    );
    await expect(svc().deleteTaxConfig("DE")).resolves.toBeUndefined();
  });

  it("calculateTax PUTs the command and returns the output", async () => {
    let body: unknown = null;
    server.use(
      http.put(`${BASE}/taxes/calculation-commands`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          input: { targetLocation: { countryCode: "DE" }, price: 100 },
          output: { net: 100, gross: 119, tax: 19 },
        });
      }),
    );
    const res = await svc().calculateTax({
      input: { targetLocation: { countryCode: "DE" }, price: 100, includesTax: false },
    });
    expect((body as { input: { price: number } }).input.price).toBe(100);
    expect(res.output?.gross).toBe(119);
  });

  it("encodeURIComponent-escapes the location code in the path", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/tax/acme/taxes/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({ locationCode: "a/b", taxClasses: [] });
      }),
    );
    await svc().getTaxConfig("a/b");
    expect(pathname).toBe("/tax/acme/taxes/a%2Fb");
  });
});
```

> If Task 1 found that PUT-update returns **204** (not the config), change the
> `updateTaxConfig` mock to `new HttpResponse(null, { status: 204 })`, drop the
> `c?.locationCode` assertion, and type the method `Promise<void>` in Step 3.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/tax.test.ts`
Expected: FAIL — cannot find module `../../src/services/tax`.

- [ ] **Step 3: Write the service**

Create `packages/sdk/src/services/tax.ts`:

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  TaxClass,
  TaxConfig,
  TaxConfigInput,
  TaxConfigCreated,
  TaxCalculationRequest,
  TaxCalculationResult,
} from "./tax-types";

export type {
  TaxClass,
  TaxConfig,
  TaxConfigInput,
  TaxConfigCreated,
  TaxCalculationRequest,
  TaxCalculationResult,
} from "./tax-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Emporix Tax Service (`/tax/{tenant}/…`): CRUD over per-location tax
 * configurations and the net/gross tax-calculation command. Every endpoint
 * requires a backend `tax.tax_read` / `tax.tax_manage` scope and the
 * **service (clientCredentials) token** — default auth: service.
 *
 * Server-side use only; the service token must never reach a browser.
 */
export class TaxService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/tax/${this.ctx.tenant}`;
  }

  /** List all per-location tax configurations. */
  async listTaxConfigs(auth: AuthContext = SERVICE): Promise<TaxConfig[]> {
    return this.ctx.http.request<TaxConfig[]>({
      method: "GET",
      path: `${this.base()}/taxes`,
      auth,
    });
  }

  /** Retrieve one tax configuration by its location (country) code. */
  async getTaxConfig(locationCode: string, auth: AuthContext = SERVICE): Promise<TaxConfig> {
    return this.ctx.http.request<TaxConfig>({
      method: "GET",
      path: `${this.base()}/taxes/${encodeURIComponent(locationCode)}`,
      auth,
    });
  }

  /** Create a tax configuration (`POST`). Returns the created `{ locationCode }`. */
  async createTaxConfig(
    input: TaxConfigInput,
    auth: AuthContext = SERVICE,
  ): Promise<TaxConfigCreated> {
    return this.ctx.http.request<TaxConfigCreated>({
      method: "POST",
      path: `${this.base()}/taxes`,
      auth,
      body: input,
    });
  }

  /**
   * Update a tax configuration by location code (`PUT`). `metadata.version` is
   * required (optimistic locking — a stale version yields 409).
   */
  async updateTaxConfig(
    locationCode: string,
    input: TaxConfigInput,
    auth: AuthContext = SERVICE,
  ): Promise<TaxConfig> {
    return this.ctx.http.request<TaxConfig>({
      method: "PUT",
      path: `${this.base()}/taxes/${encodeURIComponent(locationCode)}`,
      auth,
      body: input,
    });
  }

  /** Delete a tax configuration by location code. */
  async deleteTaxConfig(locationCode: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/taxes/${encodeURIComponent(locationCode)}`,
      auth,
    });
  }

  /**
   * Calculate net/gross values for a price (`PUT /taxes/calculation-commands`).
   * Single command in, single result out.
   */
  async calculateTax(
    request: TaxCalculationRequest,
    auth: AuthContext = SERVICE,
  ): Promise<TaxCalculationResult> {
    return this.ctx.http.request<TaxCalculationResult>({
      method: "PUT",
      path: `${this.base()}/taxes/calculation-commands`,
      auth,
      body: request,
    });
  }
}
```

Create the facade `packages/sdk/src/tax.ts`:

```ts
export * from "./services/tax";
```

> `TaxClass` is imported only so the re-export block surfaces it on
> `@viu/emporix-sdk/tax`; it is not otherwise referenced in the service body —
> that is intentional and matches the other facades.

- [ ] **Step 4: Run test + typecheck to verify they pass**

```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/tax.test.ts
pnpm -F @viu/emporix-sdk typecheck
```
Expected: all tests PASS; typecheck exits 0.

> If typecheck flags the `as never` create/update inputs as unnecessary (because
> the structural fallback types accept the literals directly), remove them.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/tax.ts packages/sdk/src/tax.ts packages/sdk/tests/services/tax.test.ts
git commit -m "feat(sdk): add tax service"
```

---

## Task 4: Wire the service onto EmporixClient

**Files:**
- Modify: `packages/sdk/src/core/logger.ts`, `packages/sdk/src/client.ts`, `packages/sdk/src/index.ts`
- Test: `packages/sdk/tests/services/tax-wiring.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/tax-wiring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { TaxService } from "../../src/services/tax";

describe("EmporixClient tax wiring", () => {
  it("exposes the tax service", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.taxes).toBeInstanceOf(TaxService);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/tax-wiring.test.ts`
Expected: FAIL — `sdk.taxes` is `undefined`.

- [ ] **Step 3a: Extend the `ServiceName` union**

In `packages/sdk/src/core/logger.ts`, add `"tax"` to the `ServiceName` union (insert after `| "ai"`, before `| "http"`):

```ts
  | "ai"
  | "tax"
  | "http"
  | "auth";
```

- [ ] **Step 3b: Import and expose the service in `client.ts`**

Add the import after the `AiService` import:

```ts
import { TaxService } from "./services/tax";
```

Add the readonly field after `ai`:

```ts
  readonly taxes: TaxService;
```

Construct it in the constructor after `this.ai = ...`:

```ts
    this.taxes = new TaxService(mk("tax"));
```

- [ ] **Step 3c: Re-export from the barrel**

In `packages/sdk/src/index.ts`, add after `export * from "./ai";`:

```ts
export * from "./tax";
```

- [ ] **Step 4: Run the test, full suite + typecheck**

```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/tax-wiring.test.ts
pnpm -F @viu/emporix-sdk test
pnpm -F @viu/emporix-sdk typecheck
```
Expected: wiring test PASS; full suite PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/core/logger.ts packages/sdk/src/client.ts packages/sdk/src/index.ts packages/sdk/tests/services/tax-wiring.test.ts
git commit -m "feat(sdk): expose tax service on the client"
```

---

## Task 5: Documentation

**Files:**
- Create: `docs/tax.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Write the usage doc**

Create `docs/tax.md`:

````markdown
# Tax Service

Bindings for the Emporix **Tax Service** (`/tax/{tenant}/…`): per-location tax
configurations (country + tax classes) and net/gross tax calculation.

> **Server-side only.** Every endpoint requires a backend `tax.tax_read` /
> `tax.tax_manage` scope, served by the **service (clientCredentials) token**.
> Never construct these calls from a browser — the admin token must not be
> exposed. Use them in Node, Next.js route handlers / server actions, or other
> trusted backends. There is no React binding.

## Tax configurations — `client.taxes`

```ts
// list / get
const configs = await client.taxes.listTaxConfigs();
const de = await client.taxes.getTaxConfig("DE");

// create — returns just { locationCode }
const { locationCode } = await client.taxes.createTaxConfig({
  location: { countryCode: "DE" },
  taxClasses: [
    { code: "STANDARD", name: { en: "Standard" }, rate: 19, order: 1, isDefault: true },
    { code: "REDUCED", name: { en: "Reduced" }, rate: 7, order: 2 },
  ],
});

// update — metadata.version is REQUIRED (409 on a stale version)
await client.taxes.updateTaxConfig("DE", {
  location: { countryCode: "DE" },
  taxClasses: [{ code: "STANDARD", rate: 19, order: 1, isDefault: true }],
  metadata: { version: de.metadata?.version ?? 0 },
});

// delete
await client.taxes.deleteTaxConfig("DE");
```

## Tax calculation

```ts
const result = await client.taxes.calculateTax({
  input: {
    targetLocation: { countryCode: "DE" },
    targetTaxClass: "STANDARD",
    price: 100,
    includesTax: false, // net → gross
  },
});
result.output?.net;   // 100
result.output?.gross; // 119
result.output?.tax;   // 19
```

## Overriding the token

All methods take an optional trailing `auth` argument (default: the `"backend"`
service credential set). Pass `auth.service("other-set")` to use a different
configured credential set, or `auth.raw(token)` for a pre-obtained token.
````

- [ ] **Step 2: Update CLAUDE.md service list**

In `CLAUDE.md`, find the `packages/sdk` row and append `Tax` before the closing paren of the service list:

```
…, Schema, AI, Tax) | yes (`@viu/emporix-sdk`) |
```

- [ ] **Step 3: Commit**

```bash
git add docs/tax.md CLAUDE.md
git commit -m "docs(sdk): document the tax service"
```

---

## Task 6: Changeset

**Files:**
- Create: `.changeset/tax-service.md`

- [ ] **Step 1: Write the changeset**

Create `.changeset/tax-service.md`:

```markdown
---
"@viu/emporix-sdk": minor
---

Add Emporix Tax Service bindings via `client.taxes`: CRUD over per-location tax
configurations (`listTaxConfigs`, `getTaxConfig`, `createTaxConfig`,
`updateTaxConfig`, `deleteTaxConfig`) and net/gross tax calculation
(`calculateTax`). Server-side only — these use the service (clientCredentials)
token and must not be called from a browser.
```

- [ ] **Step 2: Verify the changeset is recognized**

Run: `pnpm changeset status`
Expected: lists `@viu/emporix-sdk` for a minor bump.

- [ ] **Step 3: Commit**

```bash
git add .changeset/tax-service.md
git commit -m "chore(release): add tax service changeset"
```

---

## Final verification (after all tasks)

- [ ] Full package suite + typecheck + lint:
```bash
pnpm -F @viu/emporix-sdk test
pnpm -F @viu/emporix-sdk typecheck
pnpm -F @viu/emporix-sdk lint
```
- [ ] Build so examples typecheck against the new dist surface:
```bash
pnpm -F @viu/emporix-sdk build
```
All expected to pass.

---

## Self-Review (performed while writing)

- **Spec coverage:** D1 scope (CRUD + calculate) → all six methods in Task 3. D2 no React → no React tasks. D3 one service `client.taxes` → Task 4. D4 method names → Task 3 + wiring + doc match. D5 codegen + thin aliases → Tasks 1+2. D6 service-token default → `const SERVICE` in Task 3, every method defaults to it. D7 quirks: `createTaxConfig` returns `TaxConfigCreated` (`{ locationCode }`, asserted in test); `calculateTax` single (single body/response, asserted); `updateTaxConfig` version required (doc + test sends `metadata.version`, with a 204-fallback note); DELETE → void (asserted). Docs/changeset → Tasks 5/6. No gaps.
- **Placeholder scan:** No TBD/TODO. Every code step has full code. The upstream-dependent uncertainties are concrete `grep` verifications with defined fallbacks (generated names → Task 1 Step 3; PUT-update response shape → Task 3 note), not placeholders.
- **Type consistency:** Public names `TaxClass`/`TaxConfig`/`TaxConfigInput`/`TaxConfigCreated`/`TaxCalculationRequest`/`TaxCalculationResult` are identical across Task 2 (definitions), Task 3 (imports + re-exports), and the tests. Method names match across Task 3, the Task 4 wiring test, and the doc. Base path `/tax/${tenant}` matches the spec and the test `BASE`. Logger name `"tax"` matches `mk("tax")` and the `ServiceName` addition. Commit scopes are all `sdk`/`release` with lowercase verbs (commitlint-safe).
