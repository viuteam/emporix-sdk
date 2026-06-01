# Reward Points Service Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Emporix **Reward Points Service** as a core SDK service, `client.rewardPoints` (14 operations: admin points management + storefront "my points" + redeem options), plus four React hooks for the storefront flows.

**Architecture:** Types generated via `@hey-api/openapi-ts`; `reward-points-types.ts` **aliases** the generated types (structural only for the inlined public-redeem body). One `RewardPointsService` with per-group auth defaults (admin/options → service; the three `/public/*` methods require a customer `auth`). Mixed base paths (`/reward-points/…` vs `/reward-points/{tenant}/redeemOptions`) handled by two helpers. React mutation/query hooks call the service with the browser auth context.

**Tech Stack:** TypeScript, Vitest + MSW, `@hey-api/openapi-ts`, `@tanstack/react-query`, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-06-01-reward-points-service-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/sdk/scripts/fetch-specs.ts` | add the `reward-points` spec URL |
| `packages/sdk/specs/reward-points.yml` | fetched OpenAPI (committed) |
| `packages/sdk/src/generated/reward-points/{index.ts,types.gen.ts}` | generated types |
| `packages/sdk/src/services/reward-points-types.ts` | public type aliases |
| `packages/sdk/src/services/reward-points.ts` | `RewardPointsService` |
| `packages/sdk/src/reward-points.ts` | facade re-export |
| `packages/sdk/src/core/logger.ts` | add `"reward-points"` to `ServiceName` |
| `packages/sdk/src/client.ts` | construct + expose `rewardPoints` |
| `packages/sdk/src/index.ts` | re-export the facade |
| `packages/sdk/tests/services/reward-points-types.test.ts` | type-level tests |
| `packages/sdk/tests/services/reward-points.test.ts` | MSW tests |
| `packages/sdk/tests/services/reward-points-wiring.test.ts` | wiring test |
| `packages/react/src/hooks/use-reward-points.ts` | 4 hooks |
| `packages/react/src/hooks/index.ts` | re-export the hooks |
| `packages/react/src/index.ts` | surface the hooks |
| `packages/react/tests/use-reward-points.test.tsx` | hook tests |
| `docs/reward-points.md` | usage doc |
| `docs/react.md` | mention the hooks |
| `CLAUDE.md` | service-list update |
| `.changeset/reward-points-service.md` | release entry (both packages) |

All commands run from the repo root: `/Users/dominic.fritschi/projects/viu/emporix-sdk`.

**Branch:** create `feat/reward-points-service` off current `main`, commit the spec + plan docs first:
```bash
git checkout main && git pull
git checkout -b feat/reward-points-service
git add docs/superpowers/specs/2026-06-01-reward-points-service-design.md docs/superpowers/plans/2026-06-01-reward-points-service.md
git commit -m "docs(sdk): add reward points service design spec and plan"
```

---

## Task 1: Generate Reward Points types (codegen)

**Files:**
- Modify: `packages/sdk/scripts/fetch-specs.ts`
- Create (generated): `packages/sdk/specs/reward-points.yml`, `packages/sdk/src/generated/reward-points/{index.ts,types.gen.ts}`

- [ ] **Step 1: Add the spec entry**

In `packages/sdk/scripts/fetch-specs.ts`, add (after the `coupon` entry):

```ts
  "reward-points": `${BASE}/rewards-and-promotions/reward-points/api-reference/api.yml`,
```

(URL verified live → HTTP 200, ~47 KB.)

- [ ] **Step 2: Fetch + generate**

```bash
pnpm -F @viu/emporix-sdk fetch:specs
pnpm -F @viu/emporix-sdk generate
```
Expected: `fetched reward-points (...bytes)` and `src/generated/reward-points/` written.

- [ ] **Step 3: Verify the generated type names**

```bash
grep -nE "^export type " packages/sdk/src/generated/reward-points/types.gen.ts
```
Record the real names (PascalCase of the schema keys) for Task 2:
- `customerSummaryBatchOut` → e.g. `CustomerSummaryBatchOut`
- `pointsSummaryOut` → `PointsSummaryOut`
- `customerSummary` → `CustomerSummary`
- `addedPoints` → `AddedPoints`; `redeemedPoints` → `RedeemedPoints`
- `newCustomerIn` → `NewCustomerIn`
- `redeemOption` → `RedeemOption`; `redeemOptions` → `RedeemOptions`
- `redeemCouponOut` → `RedeemCouponOut`

Confirm the `/public/customer/redeem` request body is the inlined `{ redeemOptionId }` (no named schema) and the exact response shapes for create/add/redeem/update (full body vs void/201):
```bash
grep -nE "redeemOptionId|RedeemCouponOut|body" packages/sdk/src/generated/reward-points/types.gen.ts | head
```

- [ ] **Step 4: Keep the change focused**

`git status --short`. If unrelated `specs/*.yml` / `src/generated/*` drifted, restore:
```bash
git restore packages/sdk/specs packages/sdk/src/generated
git restore --staged packages/sdk/specs packages/sdk/src/generated 2>/dev/null || true
```
Re-run Step 2; stage only `reward-points` paths. (Skip if only those changed.)

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/scripts/fetch-specs.ts packages/sdk/specs/reward-points.yml packages/sdk/src/generated/reward-points
git commit -m "feat(sdk): generate reward points types"
```

---

## Task 2: Public types module

**Files:**
- Create: `packages/sdk/src/services/reward-points-types.ts`
- Test: `packages/sdk/tests/services/reward-points-types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/reward-points-types.test.ts`:

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  PointsSummary,
  CustomerPointsSummary,
  RedeemOption,
  RedeemOptionList,
  RedeemMyPointsInput,
  RedeemCouponResult,
} from "../../src/services/reward-points-types";

describe("reward points types", () => {
  it("RedeemMyPointsInput requires a redeemOptionId", () => {
    const i: RedeemMyPointsInput = { redeemOptionId: "opt-1" };
    expectTypeOf(i.redeemOptionId).toEqualTypeOf<string>();
  });

  it("RedeemCouponResult exposes the coupon code", () => {
    const r = { code: "WELCOME10" } as RedeemCouponResult;
    expectTypeOf(r.code).toEqualTypeOf<string | undefined>();
  });

  it("summary, customer summary, redeem option(s) are usable", () => {
    expectTypeOf<PointsSummary>().not.toBeNever();
    expectTypeOf<CustomerPointsSummary>().not.toBeNever();
    expectTypeOf<RedeemOption>().not.toBeNever();
    expectTypeOf<RedeemOptionList>().not.toBeNever();
  });
});
```

> Adjust assertions if Task 1 reports different optional/required flags (the
> test asserts the public contract). `code` is optional upstream on `RedeemCouponOut`.

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm -F @viu/emporix-sdk exec tsc --noEmit 2>&1 | grep reward-points-types
```
Expected: `Cannot find module '../../src/services/reward-points-types'`.

- [ ] **Step 3: Write the types module**

Create `packages/sdk/src/services/reward-points-types.ts` (**swap names for the real generated ones from Task 1**):

```ts
import type {
  CustomerSummaryBatchOut,
  PointsSummaryOut,
  CustomerSummary,
  NewCustomerIn,
  RedeemOptions,
  RedeemCouponOut,
} from "../generated/reward-points";

export type {
  /** A single add-points entry / body. */
  AddedPoints,
  /** A single redeem-points entry / body. */
  RedeemedPoints,
  /** A redeem option (`{ id?, type?, name?, points?, coupon?, … }`). */
  RedeemOption,
} from "../generated/reward-points";

/** Batch summary across all customers (`GET /summaryBatch`). */
export type CustomerSummaryBatch = CustomerSummaryBatchOut;
/** Points summary for one customer / the signed-in customer. */
export type PointsSummary = PointsSummaryOut;
/** Detailed customer points (added/redeemed entries) — `GET /customer/{id}` & `/public/customer`. */
export type CustomerPointsSummary = CustomerSummary;
/** Create-entry body (`POST /customer/{id}`). */
export type NewPointsEntry = NewCustomerIn;
/** List of redeem options (`GET /{tenant}/redeemOptions`). */
export type RedeemOptionList = RedeemOptions;
/** Result of redeeming points — the issued coupon `{ code? }`. */
export type RedeemCouponResult = RedeemCouponOut;

/** Body for `redeemMyPoints` — inlined upstream, so defined structurally. */
export interface RedeemMyPointsInput {
  redeemOptionId: string;
}
```

> If a generated name does not exist (inlined schema), define that type
> structurally; keep everything else aliased (the tax/coupon precedent).

- [ ] **Step 4: Run test + typecheck**

```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/reward-points-types.test.ts
pnpm -F @viu/emporix-sdk typecheck
```
Expected: test PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/reward-points-types.ts packages/sdk/tests/services/reward-points-types.test.ts
git commit -m "feat(sdk): add reward points public types"
```

---

## Task 3: RewardPointsService

**Files:**
- Create: `packages/sdk/src/services/reward-points.ts`, `packages/sdk/src/reward-points.ts`
- Test: `packages/sdk/tests/services/reward-points.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/reward-points.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { RewardPointsService } from "../../src/services/reward-points";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider, auth } from "../../src/core/auth";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "reward-points" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new RewardPointsService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const RP = "https://api.emporix.io/reward-points";

describe("RewardPointsService", () => {
  it("listAllSummaries GETs the batch with a service token", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(`${RP}/summaryBatch`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json({ customers: [] });
      }),
    );
    await svc().listAllSummaries();
    expect(seenAuth).toBe("Bearer svc-tok");
  });

  it("getCustomerPoints GETs a customer's points (no tenant in path)", async () => {
    let pathname = "";
    server.use(
      http.get(`${RP}/customer/C1`, ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({ customerId: "C1" });
      }),
    );
    await svc().getCustomerPoints("C1");
    expect(pathname).toBe("/reward-points/customer/C1");
  });

  it("createCustomerPoints POSTs the entry", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${RP}/customer/C1`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 201 });
      }),
    );
    await svc().createCustomerPoints("C1", { points: 100 } as never);
    expect(body).toEqual({ points: 100 });
  });

  it("deleteCustomerPoints DELETEs and resolves to void", async () => {
    server.use(http.delete(`${RP}/customer/C1`, () => new HttpResponse(null, { status: 204 })));
    await expect(svc().deleteCustomerPoints("C1")).resolves.toBeUndefined();
  });

  it("getCustomerSummary GETs the per-customer summary", async () => {
    server.use(http.get(`${RP}/customer/C1/summary`, () => HttpResponse.json({ openPoints: 50 })));
    await expect(svc().getCustomerSummary("C1")).resolves.toBeDefined();
  });

  it("addPoints POSTs to /addPoints", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${RP}/customer/C1/addPoints`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 201 });
      }),
    );
    await svc().addPoints("C1", { points: 10 } as never);
    expect(body).toEqual({ points: 10 });
  });

  it("redeemPoints POSTs to /redeemPoints", async () => {
    server.use(http.post(`${RP}/customer/C1/redeemPoints`, () => new HttpResponse(null, { status: 200 })));
    await expect(svc().redeemPoints("C1", { points: 10 } as never)).resolves.toBeUndefined();
  });

  it("getMyPoints uses the CUSTOMER token on /public/customer", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(`${RP}/public/customer`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json({ customerId: "me" });
      }),
    );
    await svc().getMyPoints(auth.customer("cust-tok"));
    expect(seenAuth).toBe("Bearer cust-tok");
  });

  it("getMySummary GETs /public/customer/summary with the customer token", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(`${RP}/public/customer/summary`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json({ openPoints: 10 });
      }),
    );
    await svc().getMySummary(auth.customer("cust-tok"));
    expect(seenAuth).toBe("Bearer cust-tok");
  });

  it("redeemMyPoints POSTs the redeemOptionId and returns the coupon code", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${RP}/public/customer/redeem`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ code: "WELCOME10" });
      }),
    );
    const res = await svc().redeemMyPoints({ redeemOptionId: "opt-1" }, auth.customer("cust-tok"));
    expect(body).toEqual({ redeemOptionId: "opt-1" });
    expect(res.code).toBe("WELCOME10");
  });

  it("listRedeemOptions GETs the tenant-scoped options", async () => {
    let pathname = "";
    server.use(
      http.get(`${RP}/acme/redeemOptions`, ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json([{ id: "opt-1" }]);
      }),
    );
    await svc().listRedeemOptions();
    expect(pathname).toBe("/reward-points/acme/redeemOptions");
  });

  it("createRedeemOption POSTs to the tenant-scoped path", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${RP}/acme/redeemOptions`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "opt-1", points: 100 });
      }),
    );
    const res = await svc().createRedeemOption({ points: 100, type: "coupon" } as never);
    expect(body).toEqual({ points: 100, type: "coupon" });
    expect((res as { id?: string }).id).toBe("opt-1");
  });

  it("updateRedeemOption PUTs to the option id", async () => {
    server.use(http.put(`${RP}/acme/redeemOptions/opt-1`, () => HttpResponse.json({ id: "opt-1" })));
    await expect(svc().updateRedeemOption("opt-1", { points: 200 } as never)).resolves.toBeDefined();
  });

  it("deleteRedeemOption DELETEs and resolves to void", async () => {
    server.use(http.delete(`${RP}/acme/redeemOptions/opt-1`, () => new HttpResponse(null, { status: 204 })));
    await expect(svc().deleteRedeemOption("opt-1")).resolves.toBeUndefined();
  });

  it("getCustomerPoints throws EmporixNotFoundError on 404", async () => {
    server.use(
      http.get(`${RP}/customer/NOPE`, () => HttpResponse.json({ status: 404, message: "x" }, { status: 404 })),
    );
    await expect(svc().getCustomerPoints("NOPE")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("encodeURIComponent-escapes the customer id", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/reward-points/customer/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({});
      }),
    );
    await svc().getCustomerPoints("a/b");
    expect(pathname).toBe("/reward-points/customer/a%2Fb");
  });
});
```

> Adjust create/add/redeem/update response mocks + return types if Task 1 found
> different shapes (e.g. a full body vs 204). The `as never` casts drop once the
> aliased input types accept the literals.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/reward-points.test.ts`
Expected: FAIL — cannot find module `../../src/services/reward-points`.

- [ ] **Step 3: Write the service**

Create `packages/sdk/src/services/reward-points.ts`:

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  CustomerSummaryBatch,
  PointsSummary,
  CustomerPointsSummary,
  NewPointsEntry,
  AddedPoints,
  RedeemedPoints,
  RedeemOption,
  RedeemOptionList,
  RedeemMyPointsInput,
  RedeemCouponResult,
} from "./reward-points-types";

export type {
  CustomerSummaryBatch,
  PointsSummary,
  CustomerPointsSummary,
  NewPointsEntry,
  AddedPoints,
  RedeemedPoints,
  RedeemOption,
  RedeemOptionList,
  RedeemMyPointsInput,
  RedeemCouponResult,
} from "./reward-points-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Emporix Reward Points Service (`/reward-points/…`): admin customer-points
 * management, the signed-in customer's own points, and redeem options.
 *
 * Auth differs per group: admin and redeem-option management default to the
 * **service token**; the `/public/*` methods require a **customer token** (they
 * accept only `CustomerAccessToken`). Note the mixed base paths — customer/
 * public/batch endpoints omit `{tenant}`, redeem options include it.
 */
export class RewardPointsService {
  constructor(private readonly ctx: ClientContext) {}

  /** Base without tenant (customer / public / batch endpoints). */
  private base(): string {
    return `/reward-points`;
  }

  /** Tenant-scoped base (redeem options only). */
  private tenantBase(): string {
    return `/reward-points/${this.ctx.tenant}`;
  }

  // --- Admin: customer points management (service token) ---

  /** Batch summary across all customers. */
  async listAllSummaries(
    query: Record<string, string | number> = {},
    auth: AuthContext = SERVICE,
  ): Promise<CustomerSummaryBatch> {
    return this.ctx.http.request<CustomerSummaryBatch>({
      method: "GET",
      path: `${this.base()}/summaryBatch`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Retrieve one customer's reward points. */
  async getCustomerPoints(customerId: string, auth: AuthContext = SERVICE): Promise<CustomerPointsSummary> {
    return this.ctx.http.request<CustomerPointsSummary>({
      method: "GET",
      path: `${this.base()}/customer/${encodeURIComponent(customerId)}`,
      auth,
    });
  }

  /** Create a reward-points entry for a customer. */
  async createCustomerPoints(
    customerId: string,
    input: NewPointsEntry,
    auth: AuthContext = SERVICE,
  ): Promise<void> {
    await this.ctx.http.request<void>({
      method: "POST",
      path: `${this.base()}/customer/${encodeURIComponent(customerId)}`,
      auth,
      body: input,
    });
  }

  /** Delete a customer's reward points. */
  async deleteCustomerPoints(customerId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/customer/${encodeURIComponent(customerId)}`,
      auth,
    });
  }

  /** Retrieve a reward-points summary for one customer. */
  async getCustomerSummary(customerId: string, auth: AuthContext = SERVICE): Promise<PointsSummary> {
    return this.ctx.http.request<PointsSummary>({
      method: "GET",
      path: `${this.base()}/customer/${encodeURIComponent(customerId)}/summary`,
      auth,
    });
  }

  /** Add reward points for a customer. */
  async addPoints(customerId: string, input: AddedPoints, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "POST",
      path: `${this.base()}/customer/${encodeURIComponent(customerId)}/addPoints`,
      auth,
      body: input,
    });
  }

  /** Redeem a customer's reward points (on behalf). */
  async redeemPoints(customerId: string, input: RedeemedPoints, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "POST",
      path: `${this.base()}/customer/${encodeURIComponent(customerId)}/redeemPoints`,
      auth,
      body: input,
    });
  }

  // --- Storefront: the signed-in customer's own points (customer token required) ---

  /** The signed-in customer's reward points. Requires a customer `auth`. */
  async getMyPoints(auth: AuthContext): Promise<CustomerPointsSummary> {
    return this.ctx.http.request<CustomerPointsSummary>({
      method: "GET",
      path: `${this.base()}/public/customer`,
      auth,
    });
  }

  /** The signed-in customer's reward-points summary. Requires a customer `auth`. */
  async getMySummary(auth: AuthContext): Promise<PointsSummary> {
    return this.ctx.http.request<PointsSummary>({
      method: "GET",
      path: `${this.base()}/public/customer/summary`,
      auth,
    });
  }

  /**
   * Redeem the signed-in customer's points for a coupon code. Requires a
   * customer `auth`. Returns the issued coupon `{ code }`.
   */
  async redeemMyPoints(input: RedeemMyPointsInput, auth: AuthContext): Promise<RedeemCouponResult> {
    return this.ctx.http.request<RedeemCouponResult>({
      method: "POST",
      path: `${this.base()}/public/customer/redeem`,
      auth,
      body: input,
    });
  }

  // --- Redeem options (tenant-scoped; read open to customer, management service-only) ---

  /** List redeem options. Defaults to the service token; pass a customer `auth` for storefront reads. */
  async listRedeemOptions(auth: AuthContext = SERVICE): Promise<RedeemOptionList> {
    return this.ctx.http.request<RedeemOptionList>({
      method: "GET",
      path: `${this.tenantBase()}/redeemOptions`,
      auth,
    });
  }

  /** Create a redeem option. */
  async createRedeemOption(input: RedeemOption, auth: AuthContext = SERVICE): Promise<RedeemOption> {
    return this.ctx.http.request<RedeemOption>({
      method: "POST",
      path: `${this.tenantBase()}/redeemOptions`,
      auth,
      body: input,
    });
  }

  /** Update a redeem option by id. */
  async updateRedeemOption(
    redeemOptionId: string,
    input: RedeemOption,
    auth: AuthContext = SERVICE,
  ): Promise<RedeemOption> {
    return this.ctx.http.request<RedeemOption>({
      method: "PUT",
      path: `${this.tenantBase()}/redeemOptions/${encodeURIComponent(redeemOptionId)}`,
      auth,
      body: input,
    });
  }

  /** Delete a redeem option by id. */
  async deleteRedeemOption(redeemOptionId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.tenantBase()}/redeemOptions/${encodeURIComponent(redeemOptionId)}`,
      auth,
    });
  }
}
```

Create the facade `packages/sdk/src/reward-points.ts`:

```ts
export * from "./services/reward-points";
```

- [ ] **Step 4: Run test + typecheck**

```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/reward-points.test.ts
pnpm -F @viu/emporix-sdk typecheck
```
Expected: all tests PASS; typecheck exits 0. Remove `as never` casts the aliased
input types accept directly.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/reward-points.ts packages/sdk/src/reward-points.ts packages/sdk/tests/services/reward-points.test.ts
git commit -m "feat(sdk): add reward points service"
```

---

## Task 4: Wire the service onto EmporixClient

**Files:**
- Modify: `packages/sdk/src/core/logger.ts`, `packages/sdk/src/client.ts`, `packages/sdk/src/index.ts`
- Test: `packages/sdk/tests/services/reward-points-wiring.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/reward-points-wiring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { RewardPointsService } from "../../src/services/reward-points";

describe("EmporixClient reward points wiring", () => {
  it("exposes the reward points service", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.rewardPoints).toBeInstanceOf(RewardPointsService);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/reward-points-wiring.test.ts`
Expected: FAIL — `sdk.rewardPoints` is `undefined`.

- [ ] **Step 3a: Extend `ServiceName`**

In `packages/sdk/src/core/logger.ts`, add `"reward-points"` (after `| "coupon"`, before `| "http"`):

```ts
  | "coupon"
  | "reward-points"
  | "http"
  | "auth";
```

- [ ] **Step 3b: Import + expose in `client.ts`**

Add the import after the `CouponService` import:

```ts
import { RewardPointsService } from "./services/reward-points";
```

Add the field after `coupons`:

```ts
  readonly rewardPoints: RewardPointsService;
```

Construct it after `this.coupons = ...`:

```ts
    this.rewardPoints = new RewardPointsService(mk("reward-points"));
```

- [ ] **Step 3c: Re-export from the barrel**

In `packages/sdk/src/index.ts`, add after `export * from "./coupon";`:

```ts
export * from "./reward-points";
```

- [ ] **Step 4: Run the test, full suite + typecheck, build**

```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/reward-points-wiring.test.ts
pnpm -F @viu/emporix-sdk test
pnpm -F @viu/emporix-sdk typecheck
pnpm -F @viu/emporix-sdk build
```
Expected: all PASS; typecheck exits 0; build succeeds (so Task 5's React package
sees `client.rewardPoints` and the new public types).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/core/logger.ts packages/sdk/src/client.ts packages/sdk/src/index.ts packages/sdk/tests/services/reward-points-wiring.test.ts
git commit -m "feat(sdk): expose reward points service on the client"
```

---

## Task 5: React hooks

**Files:**
- Create: `packages/react/src/hooks/use-reward-points.ts`
- Modify: `packages/react/src/hooks/index.ts`, `packages/react/src/index.ts`
- Test: `packages/react/tests/use-reward-points.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/react/tests/use-reward-points.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import {
  useMyRewardPoints,
  useMyRewardPointsSummary,
  useRedeemRewardPoints,
  useRedeemOptions,
} from "../src/hooks/use-reward-points";
import type { ReactNode } from "react";

const RP = "https://api.emporix.io/reward-points";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap() {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    logger: false,
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const storage = createMemoryStorage({ initial: "cust-tok" }); // logged-in customer
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
}

describe("useMyRewardPoints", () => {
  it("reads /public/customer with the customer token", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(`${RP}/public/customer`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json({ customerId: "me" });
      }),
    );
    const { result } = renderHook(() => useMyRewardPoints(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenAuth).toBe("Bearer cust-tok");
  });
});

describe("useMyRewardPointsSummary", () => {
  it("reads /public/customer/summary", async () => {
    server.use(http.get(`${RP}/public/customer/summary`, () => HttpResponse.json({ openPoints: 10 })));
    const { result } = renderHook(() => useMyRewardPointsSummary(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe("useRedeemOptions", () => {
  it("lists the tenant-scoped redeem options", async () => {
    server.use(http.get(`${RP}/acme/redeemOptions`, () => HttpResponse.json([{ id: "opt-1" }])));
    const { result } = renderHook(() => useRedeemOptions(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });
});

describe("useRedeemRewardPoints", () => {
  it("redeems points and returns the coupon code", async () => {
    server.use(http.post(`${RP}/public/customer/redeem`, () => HttpResponse.json({ code: "WELCOME10" })));
    const { result } = renderHook(() => useRedeemRewardPoints(), { wrapper: wrap() });
    await act(async () => {
      await result.current.mutateAsync({ redeemOptionId: "opt-1" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.code).toBe("WELCOME10");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-react exec vitest run tests/use-reward-points.test.tsx`
Expected: FAIL — cannot find module `../src/hooks/use-reward-points`.

- [ ] **Step 3: Write the hooks**

Create `packages/react/src/hooks/use-reward-points.ts`:

```ts
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from "@tanstack/react-query";
import type {
  CustomerPointsSummary,
  PointsSummary,
  RedeemOptionList,
  RedeemMyPointsInput,
  RedeemCouponResult,
} from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useCustomerOnlyCtx } from "./internal/use-read-auth";
import { useReadAuth } from "./internal/use-read-auth";
import { emporixKey } from "./internal/query-keys";

const STALE = 30_000;
const INVALIDATE_KEY = ["emporix", "reward-points"] as const;

/** The signed-in customer's reward points (customer-only). */
export function useMyRewardPoints(): UseQueryResult<CustomerPointsSummary> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  return useQuery({
    queryKey: emporixKey("reward-points", ["mine"], { tenant: client.tenant, authKind: ctx.kind }),
    queryFn: () => client.rewardPoints.getMyPoints(ctx),
    staleTime: STALE,
  });
}

/** The signed-in customer's reward-points summary (customer-only). */
export function useMyRewardPointsSummary(): UseQueryResult<PointsSummary> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  return useQuery({
    queryKey: emporixKey("reward-points", ["mine", "summary"], { tenant: client.tenant, authKind: ctx.kind }),
    queryFn: () => client.rewardPoints.getMySummary(ctx),
    staleTime: STALE,
  });
}

/** List redeem options (works for guests and customers). */
export function useRedeemOptions(): UseQueryResult<RedeemOptionList> {
  const { client } = useEmporix();
  const { ctx } = useReadAuth();
  return useQuery({
    queryKey: emporixKey("reward-points", ["redeem-options"], { tenant: client.tenant, authKind: ctx.kind }),
    queryFn: () => client.rewardPoints.listRedeemOptions(ctx),
    staleTime: STALE,
  });
}

/** Redeem the signed-in customer's points for a coupon code. */
export function useRedeemRewardPoints(): UseMutationResult<RedeemCouponResult, unknown, RedeemMyPointsInput> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RedeemMyPointsInput) => client.rewardPoints.redeemMyPoints(input, ctx),
    onSuccess: () => void qc.invalidateQueries({ queryKey: INVALIDATE_KEY }),
  });
}
```

> Verify `emporixKey`'s signature against `./internal/query-keys` (it is used by
> `use-shopping-lists.ts` as `emporixKey(name, parts, { tenant, authKind, siteCode? })`).
> Drop `siteCode` here — reward points are not site-scoped.

- [ ] **Step 4: Re-export the hooks**

In `packages/react/src/hooks/index.ts`, add next to the other hook exports:

```ts
export {
  useMyRewardPoints,
  useMyRewardPointsSummary,
  useRedeemOptions,
  useRedeemRewardPoints,
} from "./use-reward-points";
```

In `packages/react/src/index.ts`, add the four names to the
`export { … } from "./hooks/index";` block (after `useRedeemCoupon`).

- [ ] **Step 5: Run test + typecheck**

```bash
pnpm -F @viu/emporix-sdk-react exec vitest run tests/use-reward-points.test.tsx
pnpm -F @viu/emporix-sdk-react test
pnpm -F @viu/emporix-sdk-react typecheck
```
Expected: hook tests PASS; full react suite PASS; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/hooks/use-reward-points.ts packages/react/src/hooks/index.ts packages/react/src/index.ts packages/react/tests/use-reward-points.test.tsx
git commit -m "feat(react): add reward points hooks"
```

---

## Task 6: Documentation

**Files:**
- Create: `docs/reward-points.md`
- Modify: `docs/react.md`, `CLAUDE.md`

- [ ] **Step 1: Write the usage doc**

Create `docs/reward-points.md`:

````markdown
# Reward Points Service

Bindings for the Emporix **Reward Points Service** (`/reward-points/…`): admin
customer-points management, the signed-in customer's own points, and redeem
options. Redeeming points issues a **coupon code**.

> **Per-group auth.** Admin endpoints and redeem-option management use the
> **service token**. The `/public/*` ("my points") endpoints accept only a
> **customer token** — pass `auth.customer(token)` (the React hooks do this).
> Redeem-option **reads** work with either.
>
> **Path quirk:** customer/public endpoints have no tenant segment
> (`/reward-points/customer/{id}`); redeem options are tenant-scoped
> (`/reward-points/{tenant}/redeemOptions`). The SDK handles this for you.

## Admin (server-side)

```ts
const batch = await client.rewardPoints.listAllSummaries();
const points = await client.rewardPoints.getCustomerPoints("C0123");
const summary = await client.rewardPoints.getCustomerSummary("C0123");
await client.rewardPoints.createCustomerPoints("C0123", { points: 100 });
await client.rewardPoints.addPoints("C0123", { points: 50 });
await client.rewardPoints.redeemPoints("C0123", { points: 20 });
await client.rewardPoints.deleteCustomerPoints("C0123");
```

## My points (storefront — customer token)

```ts
const mine = await client.rewardPoints.getMyPoints(auth.customer(token));
const mySummary = await client.rewardPoints.getMySummary(auth.customer(token));

// redeem points for a coupon code
const { code } = await client.rewardPoints.redeemMyPoints(
  { redeemOptionId: "opt-1" },
  auth.customer(token),
);
```

## Redeem options

```ts
const options = await client.rewardPoints.listRedeemOptions();
await client.rewardPoints.createRedeemOption({ type: "coupon", points: 100, name: "10% off" });
await client.rewardPoints.updateRedeemOption("opt-1", { points: 150 });
await client.rewardPoints.deleteRedeemOption("opt-1");
```

## React hooks (storefront)

```tsx
import {
  useMyRewardPoints,
  useMyRewardPointsSummary,
  useRedeemOptions,
  useRedeemRewardPoints,
} from "@viu/emporix-sdk-react";

const { data: mine } = useMyRewardPoints();          // customer-only
const { data: summary } = useMyRewardPointsSummary(); // customer-only
const { data: options } = useRedeemOptions();         // guest or customer
const redeem = useRedeemRewardPoints();

const { code } = await redeem.mutateAsync({ redeemOptionId: "opt-1" });
```

`useMyRewardPoints` / `useMyRewardPointsSummary` / `useRedeemRewardPoints`
require a logged-in customer (they throw without a stored token).
````

- [ ] **Step 2: Mention the hooks in `docs/react.md`**

Add a short "Reward points" subsection (before `## Errors`) listing the four
hooks and the customer-only note, mirroring the "Coupons" subsection.

- [ ] **Step 3: Update CLAUDE.md service list**

Append `RewardPoints` to the `packages/sdk` row's service list:

```
…, Tax, Coupon, RewardPoints) | yes (`@viu/emporix-sdk`) |
```

- [ ] **Step 4: Commit**

```bash
git add docs/reward-points.md docs/react.md CLAUDE.md
git commit -m "docs(sdk): document the reward points service and hooks"
```

---

## Task 7: Changeset

**Files:**
- Create: `.changeset/reward-points-service.md`

- [ ] **Step 1: Write the changeset (both packages)**

Create `.changeset/reward-points-service.md`:

```markdown
---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add Emporix Reward Points Service bindings via `client.rewardPoints`: admin
customer-points management (`listAllSummaries`, `getCustomerPoints`,
`createCustomerPoints`, `deleteCustomerPoints`, `getCustomerSummary`,
`addPoints`, `redeemPoints`), the signed-in customer's own points
(`getMyPoints`, `getMySummary`, `redeemMyPoints` → coupon code), and redeem
options (`listRedeemOptions`, `createRedeemOption`, `updateRedeemOption`,
`deleteRedeemOption`). Admin methods default to the service token; the
`/public/*` methods require a customer token. Adds React hooks
`useMyRewardPoints`, `useMyRewardPointsSummary`, `useRedeemRewardPoints` and
`useRedeemOptions`.
```

- [ ] **Step 2: Verify**

Run: `pnpm changeset status`
Expected: `@viu/emporix-sdk` and `@viu/emporix-sdk-react` both bumped minor.

- [ ] **Step 3: Commit**

```bash
git add .changeset/reward-points-service.md
git commit -m "chore(release): add reward points service changeset"
```

---

## Final verification (after all tasks)

```bash
pnpm -F @viu/emporix-sdk test && pnpm -F @viu/emporix-sdk typecheck && pnpm -F @viu/emporix-sdk lint
pnpm -F @viu/emporix-sdk build
pnpm -F @viu/emporix-sdk-react test && pnpm -F @viu/emporix-sdk-react typecheck && pnpm -F @viu/emporix-sdk-react lint
```
All expected to pass.

---

## Self-Review (performed while writing)

- **Spec coverage:** D1 full scope (14 ops) → all methods in Task 3 + tests. D2 one service → Task 4. D3 per-group auth → admin/options default `SERVICE`; the three `/public/*` methods take a required `auth` (no default); `listRedeemOptions` defaults service, overridable. D4 four React hooks → Task 5 + exports + tests. D5 codegen + aliasing → Tasks 1+2 (structural only for the inlined `RedeemMyPointsInput`). D6 mixed base paths → `base()` (no tenant) vs `tenantBase()`; tests assert both `/reward-points/customer/C1` and `/reward-points/acme/redeemOptions`. Docs/changeset → Tasks 6/7 (both packages). No gaps.
- **Placeholder scan:** No TBD/TODO. Every code step has full code. Upstream-dependent uncertainties (generated names, create/add/redeem/update response shapes) are concrete `grep`/note verifications with fallbacks.
- **Type consistency:** Public names (`CustomerSummaryBatch`/`PointsSummary`/`CustomerPointsSummary`/`NewPointsEntry`/`AddedPoints`/`RedeemedPoints`/`RedeemOption`/`RedeemOptionList`/`RedeemMyPointsInput`/`RedeemCouponResult`) are identical across Task 2 (defs), Task 3 (imports + re-exports), and the tests. `RedeemMyPointsInput`/`RedeemCouponResult`/`CustomerPointsSummary`/`PointsSummary`/`RedeemOptionList` are imported by the React hooks from `@viu/emporix-sdk` (requires the Task 4 build before Task 5). Method names match across Task 3, the wiring test, the hooks, and the docs. Logger `"reward-points"` matches `mk("reward-points")` and the `ServiceName` addition. Customer-only `/public/*` methods take a required `auth`; the hooks supply it via `useCustomerOnlyCtx`. Commit scopes are `sdk`/`react`/`release` with lowercase verbs (commitlint-safe).
```
