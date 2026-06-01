# Coupon Service Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Emporix **Coupon Service** as a core SDK service, `client.coupons` (13 operations: CRUD + validation + redemptions + referral), plus two React hooks (`useValidateCoupon`, `useRedeemCoupon`) for the customer-facing flows.

**Architecture:** Types generated via `@hey-api/openapi-ts`; a thin `coupon-types.ts` re-exports stable public names. One `CouponService` mirrors the upstream service, defaulting every method to the service (clientCredentials) token, overridable via a trailing `auth` argument. Two React mutation hooks call the service with the browser (customer/anonymous) auth context resolved by the existing `useReadAuth()` helper, so the service token never reaches a browser.

**Tech Stack:** TypeScript, Vitest + MSW, `@hey-api/openapi-ts`, `@tanstack/react-query`, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-06-01-coupon-service-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/sdk/scripts/fetch-specs.ts` | add the `coupon` spec URL |
| `packages/sdk/specs/coupon.yml` | fetched OpenAPI (committed artifact) |
| `packages/sdk/src/generated/coupon/{index.ts,types.gen.ts}` | generated types |
| `packages/sdk/src/services/coupon-types.ts` | public type aliases |
| `packages/sdk/src/services/coupon.ts` | `CouponService` |
| `packages/sdk/src/coupon.ts` | facade re-export |
| `packages/sdk/src/core/logger.ts` | add `"coupon"` to `ServiceName` |
| `packages/sdk/src/client.ts` | construct + expose `coupons` |
| `packages/sdk/src/index.ts` | re-export the facade |
| `packages/sdk/tests/services/coupon-types.test.ts` | type-level tests |
| `packages/sdk/tests/services/coupon.test.ts` | MSW tests |
| `packages/sdk/tests/services/coupon-wiring.test.ts` | client wiring test |
| `packages/react/src/hooks/use-coupons.ts` | `useValidateCoupon`, `useRedeemCoupon` |
| `packages/react/src/hooks/index.ts` | re-export the new hooks |
| `packages/react/src/index.ts` | surface the new hooks on the package root |
| `packages/react/tests/hooks/use-coupons.test.tsx` | hook tests |
| `docs/coupon.md` | usage doc |
| `docs/react.md` | mention the two hooks |
| `CLAUDE.md` | service-list update |
| `.changeset/coupon-service.md` | release entry (both packages) |

All commands run from the repo root: `/Users/dominic.fritschi/projects/viu/emporix-sdk`.

**Branch:** create `feat/coupon-service` off current `main`, commit the spec + plan docs first:
```bash
git checkout main && git pull
git checkout -b feat/coupon-service
git add docs/superpowers/specs/2026-06-01-coupon-service-design.md docs/superpowers/plans/2026-06-01-coupon-service.md
git commit -m "docs(sdk): add coupon service design spec and plan"
```

---

## Task 1: Generate Coupon Service types (codegen)

**Files:**
- Modify: `packages/sdk/scripts/fetch-specs.ts`
- Create (generated): `packages/sdk/specs/coupon.yml`, `packages/sdk/src/generated/coupon/{index.ts,types.gen.ts}`

- [ ] **Step 1: Add the spec entry**

In `packages/sdk/scripts/fetch-specs.ts`, add to the `SPECS` object (after the `tax-service` entry — assumes tax-service is already merged; if not, add after `price`):

```ts
  coupon: `${BASE}/rewards-and-promotions/coupon/api-reference/api.yml`,
```

(URL verified live → HTTP 200, ~59 KB.)

- [ ] **Step 2: Fetch + generate**

```bash
pnpm -F @viu/emporix-sdk fetch:specs
pnpm -F @viu/emporix-sdk generate
```
Expected: `fetched coupon (...bytes)` and `src/generated/coupon/` written.

- [ ] **Step 3: Verify the generated type names**

```bash
grep -nE "^export type " packages/sdk/src/generated/coupon/types.gen.ts
```
Record the exact name for each role (scratch note for Task 2):
- coupon read shape (has `code`, `status`) → e.g. `Coupon`
- coupon list response → e.g. `CouponList`
- create body → e.g. `CreateCouponBody`
- update body (PUT/PATCH) → e.g. `UpdateCouponBody`
- redemption read → e.g. `Redemption`
- redemption create body (`orderCode?`, `customerNumber?`) → e.g. `RedemptionCreation`
- redeem 201 response → e.g. `ResourceLocation`
- referral coupon → e.g. `ReferralCoupon`

Confirm the PATCH body shape and the create/update/redeem response shapes:
```bash
grep -nE "code|status|orderCode|customerNumber|location" packages/sdk/src/generated/coupon/types.gen.ts | head
```
Inlined schemas → define structurally in Task 2 (note which).

- [ ] **Step 4: Keep the change focused**

`git status --short`. If unrelated `specs/*.yml` / `src/generated/*` drifted, restore them:
```bash
git restore packages/sdk/specs packages/sdk/src/generated
git restore --staged packages/sdk/specs packages/sdk/src/generated 2>/dev/null || true
```
Re-run Step 2 and stage only the `coupon` paths. (Skip if only `coupon` files changed.)

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/scripts/fetch-specs.ts packages/sdk/specs/coupon.yml packages/sdk/src/generated/coupon
git commit -m "feat(sdk): generate coupon service types"
```

---

## Task 2: Public types module

**Files:**
- Create: `packages/sdk/src/services/coupon-types.ts`
- Test: `packages/sdk/tests/services/coupon-types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/coupon-types.test.ts`:

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  Coupon,
  CouponInput,
  Redemption,
  RedemptionInput,
  RedemptionCreated,
  ReferralCoupon,
} from "../../src/services/coupon-types";

describe("coupon types", () => {
  it("Coupon carries a code", () => {
    const c = { code: "SUMMER" } as Coupon;
    expectTypeOf(c.code).toEqualTypeOf<string | undefined>();
  });

  it("CouponInput is usable as a create body", () => {
    expectTypeOf<CouponInput>().not.toBeNever();
  });

  it("RedemptionInput accepts orderCode and optional customerNumber", () => {
    const r: RedemptionInput = { orderCode: "O1" };
    expectTypeOf(r.orderCode).toEqualTypeOf<string | undefined>();
  });

  it("Redemption / RedemptionCreated / ReferralCoupon are usable", () => {
    expectTypeOf<Redemption>().not.toBeNever();
    expectTypeOf<RedemptionCreated>().not.toBeNever();
    expectTypeOf<ReferralCoupon>().not.toBeNever();
  });
});
```

> Adjust the `expectTypeOf` lines if Task 1 reported required/optional fields
> different from the above (the test asserts the public contract, not generated names).

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/coupon-types.test.ts
pnpm -F @viu/emporix-sdk exec tsc --noEmit 2>&1 | grep coupon-types
```
Expected: typecheck FAIL — `Cannot find module '../../src/services/coupon-types'`.

- [ ] **Step 3: Write the types module**

Create `packages/sdk/src/services/coupon-types.ts` (**swap `Gen*` names for the real generated ones from Task 1**).

> **Prefer aliasing the generated types** (single source of truth, no drift, faithful required/optional flags). Where a *read* field is loosely optional upstream but always present in practice, narrow it with `Omit<Gen, "x"> & { x: T }` (the tax-service precedent) rather than redefining the whole type. Reserve the structural definitions below **only** for schemas that are inlined upstream (no named export) — never as a substitute for an available generated type.

```ts
import type {
  Coupon as GenCoupon,
  CouponList as GenCouponList,
  CreateCouponBody as GenCouponInput,
  UpdateCouponBody as GenCouponUpdate,
  Redemption as GenRedemption,
  RedemptionCreation as GenRedemptionInput,
  ResourceLocation as GenRedemptionCreated,
  ReferralCoupon as GenReferralCoupon,
} from "../generated/coupon";

/** A coupon (read shape). */
export type Coupon = GenCoupon;
/** Paginated list of coupons (`GET /coupons`). */
export type CouponList = GenCouponList;
/** Create body (`POST /coupons`). */
export type CouponInput = GenCouponInput;
/** Update body (`PUT` / `PATCH /coupons/{code}`). */
export type CouponUpdate = GenCouponUpdate;
/** A coupon redemption (read shape). */
export type Redemption = GenRedemption;
/**
 * Redemption request body (`validation` and `redemptions`). `customerNumber`
 * is honored only with the `coupon.coupon_redeem_on_behalf` scope.
 */
export type RedemptionInput = GenRedemptionInput;
/** `POST /redemptions` 201 response — the created redemption's location/id. */
export type RedemptionCreated = GenRedemptionCreated;
/** A customer's referral coupon. */
export type ReferralCoupon = GenReferralCoupon;
```

Structural fallback for any inlined schema, e.g.:

```ts
export interface RedemptionInput {
  orderCode?: string;
  customerNumber?: string;
  legalEntityId?: string;
}
export interface RedemptionCreated { location?: string; id?: string }
```

- [ ] **Step 4: Run test + typecheck**

```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/coupon-types.test.ts
pnpm -F @viu/emporix-sdk typecheck
```
Expected: test PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/coupon-types.ts packages/sdk/tests/services/coupon-types.test.ts
git commit -m "feat(sdk): add coupon service public types"
```

---

## Task 3: CouponService

**Files:**
- Create: `packages/sdk/src/services/coupon.ts`, `packages/sdk/src/coupon.ts`
- Test: `packages/sdk/tests/services/coupon.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/coupon.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { CouponService } from "../../src/services/coupon";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "coupon" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new CouponService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/coupon/acme";

describe("CouponService", () => {
  it("listCoupons GETs the list with a service token", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(`${BASE}/coupons`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json([{ code: "SUMMER" }]);
      }),
    );
    const out = await svc().listCoupons();
    expect(seenAuth).toBe("Bearer svc-tok");
    expect(out).toEqual([{ code: "SUMMER" }]);
  });

  it("getCoupon fetches one by code", async () => {
    server.use(http.get(`${BASE}/coupons/SUMMER`, () => HttpResponse.json({ code: "SUMMER" })));
    expect((await svc().getCoupon("SUMMER")).code).toBe("SUMMER");
  });

  it("getCoupon throws EmporixNotFoundError on 404", async () => {
    server.use(
      http.get(`${BASE}/coupons/NOPE`, () =>
        HttpResponse.json({ status: 404, message: "x" }, { status: 404 }),
      ),
    );
    await expect(svc().getCoupon("NOPE")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("createCoupon POSTs the body", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/coupons`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ code: "SUMMER" }, { status: 201 });
      }),
    );
    const c = await svc().createCoupon({ code: "SUMMER", type: "RELATIVE" } as never);
    expect(body).toEqual({ code: "SUMMER", type: "RELATIVE" });
    expect(c.code).toBe("SUMMER");
  });

  it("updateCoupon PUTs to the code", async () => {
    server.use(http.put(`${BASE}/coupons/SUMMER`, () => HttpResponse.json({ code: "SUMMER" })));
    expect((await svc().updateCoupon("SUMMER", { name: "Summer" } as never)).code).toBe("SUMMER");
  });

  it("patchCoupon PATCHes the partial body", async () => {
    let body: unknown = null;
    server.use(
      http.patch(`${BASE}/coupons/SUMMER`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ code: "SUMMER" });
      }),
    );
    await svc().patchCoupon("SUMMER", { name: "Renamed" } as never);
    expect(body).toEqual({ name: "Renamed" });
  });

  it("deleteCoupon DELETEs and resolves to void", async () => {
    server.use(http.delete(`${BASE}/coupons/SUMMER`, () => new HttpResponse(null, { status: 204 })));
    await expect(svc().deleteCoupon("SUMMER")).resolves.toBeUndefined();
  });

  it("validateCoupon POSTs to /validation and resolves to void on 200", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/coupons/SUMMER/validation`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 200 });
      }),
    );
    await expect(svc().validateCoupon("SUMMER", { orderCode: "O1" })).resolves.toBeUndefined();
    expect(body).toEqual({ orderCode: "O1" });
  });

  it("listRedemptions GETs the array", async () => {
    server.use(
      http.get(`${BASE}/coupons/SUMMER/redemptions`, () =>
        HttpResponse.json([{ id: "r1", redeemedAt: "2026-01-01T00:00:00Z" }]),
      ),
    );
    expect(await svc().listRedemptions("SUMMER")).toHaveLength(1);
  });

  it("redeemCoupon POSTs and returns the resource location", async () => {
    server.use(
      http.post(`${BASE}/coupons/SUMMER/redemptions`, () =>
        HttpResponse.json({ id: "r1", location: "/coupon/acme/coupons/SUMMER/redemptions/r1" }, { status: 201 }),
      ),
    );
    const res = await svc().redeemCoupon("SUMMER", { orderCode: "O1" });
    expect((res as { id?: string }).id).toBe("r1");
  });

  it("getRedemption fetches one redemption", async () => {
    server.use(
      http.get(`${BASE}/coupons/SUMMER/redemptions/r1`, () => HttpResponse.json({ id: "r1" })),
    );
    expect((await svc().getRedemption("SUMMER", "r1")).id).toBe("r1");
  });

  it("deleteRedemption DELETEs and resolves to void", async () => {
    server.use(
      http.delete(`${BASE}/coupons/SUMMER/redemptions/r1`, () => new HttpResponse(null, { status: 204 })),
    );
    await expect(svc().deleteRedemption("SUMMER", "r1")).resolves.toBeUndefined();
  });

  it("getReferralCoupon fetches by customerNumber", async () => {
    server.use(
      http.get(`${BASE}/referral-coupons/C0123`, () => HttpResponse.json({ code: "REF-C0123" })),
    );
    expect((await svc().getReferralCoupon("C0123")) as { code?: string }).toEqual({ code: "REF-C0123" });
  });

  it("createReferralCoupon POSTs for a customerNumber", async () => {
    server.use(
      http.post(`${BASE}/referral-coupons/C0123`, () =>
        HttpResponse.json({ code: "REF-C0123" }, { status: 201 }),
      ),
    );
    expect(((await svc().createReferralCoupon("C0123")) as { code?: string }).code).toBe("REF-C0123");
  });

  it("encodeURIComponent-escapes the coupon code in the path", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/coupon/acme/coupons/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({ code: "a/b" });
      }),
    );
    await svc().getCoupon("a/b");
    expect(pathname).toBe("/coupon/acme/coupons/a%2Fb");
  });
});
```

> If Task 1 found `createCoupon`/`updateCoupon`/`patchCoupon` return 204 (no body)
> or `{ code }` only, adjust those mocks + return types per the note in Step 3.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/coupon.test.ts`
Expected: FAIL — cannot find module `../../src/services/coupon`.

- [ ] **Step 3: Write the service**

Create `packages/sdk/src/services/coupon.ts`:

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  Coupon,
  CouponList,
  CouponInput,
  CouponUpdate,
  Redemption,
  RedemptionInput,
  RedemptionCreated,
  ReferralCoupon,
} from "./coupon-types";

export type {
  Coupon,
  CouponList,
  CouponInput,
  CouponUpdate,
  Redemption,
  RedemptionInput,
  RedemptionCreated,
  ReferralCoupon,
} from "./coupon-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Emporix Coupon Service (`/coupon/{tenant}/…`): coupon CRUD, validation,
 * redemptions, and referral coupons.
 *
 * Every method defaults to the **service (clientCredentials) token**. For
 * customer-driven validation/redemption, pass `auth.customer(token)` as the
 * trailing argument (the React hooks do this with the browser context). The
 * service token must never reach a browser.
 */
export class CouponService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/coupon/${this.ctx.tenant}`;
  }

  /** List coupons by criteria. */
  async listCoupons(
    query: Record<string, string | number> = {},
    auth: AuthContext = SERVICE,
  ): Promise<CouponList> {
    return this.ctx.http.request<CouponList>({
      method: "GET",
      path: `${this.base()}/coupons`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Retrieve one coupon by code. */
  async getCoupon(code: string, auth: AuthContext = SERVICE): Promise<Coupon> {
    return this.ctx.http.request<Coupon>({
      method: "GET",
      path: `${this.base()}/coupons/${encodeURIComponent(code)}`,
      auth,
    });
  }

  /** Create a coupon (`POST`). */
  async createCoupon(input: CouponInput, auth: AuthContext = SERVICE): Promise<Coupon> {
    return this.ctx.http.request<Coupon>({
      method: "POST",
      path: `${this.base()}/coupons`,
      auth,
      body: input,
    });
  }

  /** Replace a coupon by code (`PUT`). */
  async updateCoupon(code: string, input: CouponUpdate, auth: AuthContext = SERVICE): Promise<Coupon> {
    return this.ctx.http.request<Coupon>({
      method: "PUT",
      path: `${this.base()}/coupons/${encodeURIComponent(code)}`,
      auth,
      body: input,
    });
  }

  /** Partially update a coupon by code (`PATCH` merge body). */
  async patchCoupon(code: string, patch: CouponUpdate, auth: AuthContext = SERVICE): Promise<Coupon> {
    return this.ctx.http.request<Coupon>({
      method: "PATCH",
      path: `${this.base()}/coupons/${encodeURIComponent(code)}`,
      auth,
      body: patch,
    });
  }

  /** Delete a coupon by code. */
  async deleteCoupon(code: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/coupons/${encodeURIComponent(code)}`,
      auth,
    });
  }

  /**
   * Check whether a coupon can be redeemed (`POST /validation`). Resolves to
   * `void` when redeemable; throws an `EmporixError` otherwise (no body).
   */
  async validateCoupon(
    code: string,
    redemption: RedemptionInput,
    auth: AuthContext = SERVICE,
  ): Promise<void> {
    await this.ctx.http.request<void>({
      method: "POST",
      path: `${this.base()}/coupons/${encodeURIComponent(code)}/validation`,
      auth,
      body: redemption,
    });
  }

  /** List a coupon's redemptions by criteria. */
  async listRedemptions(
    code: string,
    query: Record<string, string | number> = {},
    auth: AuthContext = SERVICE,
  ): Promise<Redemption[]> {
    return this.ctx.http.request<Redemption[]>({
      method: "GET",
      path: `${this.base()}/coupons/${encodeURIComponent(code)}/redemptions`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Redeem a coupon by creating a redemption (`POST`, HTTP 201). */
  async redeemCoupon(
    code: string,
    redemption: RedemptionInput,
    auth: AuthContext = SERVICE,
  ): Promise<RedemptionCreated> {
    return this.ctx.http.request<RedemptionCreated>({
      method: "POST",
      path: `${this.base()}/coupons/${encodeURIComponent(code)}/redemptions`,
      auth,
      body: redemption,
    });
  }

  /** Retrieve one redemption by id. */
  async getRedemption(code: string, id: string, auth: AuthContext = SERVICE): Promise<Redemption> {
    return this.ctx.http.request<Redemption>({
      method: "GET",
      path: `${this.base()}/coupons/${encodeURIComponent(code)}/redemptions/${encodeURIComponent(id)}`,
      auth,
    });
  }

  /** Delete a redemption by id. */
  async deleteRedemption(code: string, id: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/coupons/${encodeURIComponent(code)}/redemptions/${encodeURIComponent(id)}`,
      auth,
    });
  }

  /** Retrieve a customer's referral coupon. */
  async getReferralCoupon(customerNumber: string, auth: AuthContext = SERVICE): Promise<ReferralCoupon> {
    return this.ctx.http.request<ReferralCoupon>({
      method: "GET",
      path: `${this.base()}/referral-coupons/${encodeURIComponent(customerNumber)}`,
      auth,
    });
  }

  /** Create a referral coupon code for a customer. */
  async createReferralCoupon(
    customerNumber: string,
    body: Record<string, unknown> = {},
    auth: AuthContext = SERVICE,
  ): Promise<ReferralCoupon> {
    return this.ctx.http.request<ReferralCoupon>({
      method: "POST",
      path: `${this.base()}/referral-coupons/${encodeURIComponent(customerNumber)}`,
      auth,
      body,
    });
  }
}
```

Create the facade `packages/sdk/src/coupon.ts`:

```ts
export * from "./services/coupon";
```

- [ ] **Step 4: Run test + typecheck**

```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/coupon.test.ts
pnpm -F @viu/emporix-sdk typecheck
```
Expected: all tests PASS; typecheck exits 0. Remove any now-unnecessary `as never`
casts the structural types accept directly.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/coupon.ts packages/sdk/src/coupon.ts packages/sdk/tests/services/coupon.test.ts
git commit -m "feat(sdk): add coupon service"
```

---

## Task 4: Wire the service onto EmporixClient

**Files:**
- Modify: `packages/sdk/src/core/logger.ts`, `packages/sdk/src/client.ts`, `packages/sdk/src/index.ts`
- Test: `packages/sdk/tests/services/coupon-wiring.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/coupon-wiring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { CouponService } from "../../src/services/coupon";

describe("EmporixClient coupon wiring", () => {
  it("exposes the coupon service", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.coupons).toBeInstanceOf(CouponService);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/coupon-wiring.test.ts`
Expected: FAIL — `sdk.coupons` is `undefined`.

- [ ] **Step 3a: Extend the `ServiceName` union**

In `packages/sdk/src/core/logger.ts`, add `"coupon"` (after `| "tax"`, before `| "http"`):

```ts
  | "tax"
  | "coupon"
  | "http"
  | "auth";
```

- [ ] **Step 3b: Import and expose the service in `client.ts`**

Add the import after the `TaxService` import:

```ts
import { CouponService } from "./services/coupon";
```

Add the readonly field after `taxes`:

```ts
  readonly coupons: CouponService;
```

Construct it after `this.taxes = ...`:

```ts
    this.coupons = new CouponService(mk("coupon"));
```

- [ ] **Step 3c: Re-export from the barrel**

In `packages/sdk/src/index.ts`, add after `export * from "./tax";`:

```ts
export * from "./coupon";
```

- [ ] **Step 4: Run the test, full suite + typecheck**

```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/coupon-wiring.test.ts
pnpm -F @viu/emporix-sdk test
pnpm -F @viu/emporix-sdk typecheck
```
Expected: all PASS; typecheck exits 0.

- [ ] **Step 5: Build the SDK (React typechecks against `dist/`)**

```bash
pnpm -F @viu/emporix-sdk build
```
Required so Task 5's React package sees `client.coupons` and the new public types.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/core/logger.ts packages/sdk/src/client.ts packages/sdk/src/index.ts packages/sdk/tests/services/coupon-wiring.test.ts
git commit -m "feat(sdk): expose coupon service on the client"
```

---

## Task 5: React hooks — `useValidateCoupon`, `useRedeemCoupon`

**Files:**
- Create: `packages/react/src/hooks/use-coupons.ts`
- Modify: `packages/react/src/hooks/index.ts`, `packages/react/src/index.ts`
- Test: `packages/react/tests/hooks/use-coupons.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/react/tests/hooks/use-coupons.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../../src/provider";
import { createMemoryStorage } from "../../src/storage/memory";
import { useValidateCoupon, useRedeemCoupon } from "../../src/hooks/use-coupons";
import type { ReactNode } from "react";

const BASE = "https://api.emporix.io/coupon/acme/coupons/SUMMER";

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
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const storage = createMemoryStorage({ initial: "cust-tok" }); // logged-in customer
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
}

describe("useValidateCoupon", () => {
  it("POSTs to /validation with the customer token and succeeds", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.post(`${BASE}/validation`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return new HttpResponse(null, { status: 200 });
      }),
    );
    const { result } = renderHook(() => useValidateCoupon(), { wrapper: wrap() });
    await act(async () => {
      await result.current.mutateAsync({ code: "SUMMER", redemption: { orderCode: "O1" } });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenAuth).toBe("Bearer cust-tok");
  });
});

describe("useRedeemCoupon", () => {
  it("POSTs to /redemptions and returns the resource location", async () => {
    server.use(
      http.post(`${BASE}/redemptions`, () =>
        HttpResponse.json({ id: "r1" }, { status: 201 }),
      ),
    );
    const { result } = renderHook(() => useRedeemCoupon(), { wrapper: wrap() });
    await act(async () => {
      await result.current.mutateAsync({ code: "SUMMER", redemption: { orderCode: "O1" } });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect((result.current.data as { id?: string }).id).toBe("r1");
  });
});
```

> Verify the customer-token import path: `createMemoryStorage` is imported from
> `../../src/storage/memory` (matching `use-shopping-lists.test.tsx`). If the
> repo exposes it elsewhere, match the existing test's import.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-react exec vitest run tests/hooks/use-coupons.test.tsx`
Expected: FAIL — cannot find module `../../src/hooks/use-coupons`.

- [ ] **Step 3: Write the hooks**

Create `packages/react/src/hooks/use-coupons.ts`:

```ts
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { RedemptionInput, RedemptionCreated } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useReadAuth } from "./internal/use-read-auth";

const INVALIDATE_KEY = ["emporix", "coupons"] as const;

/** Variables for the coupon action hooks. */
export interface CouponActionVars {
  code: string;
  redemption: RedemptionInput;
}

/**
 * Check whether a coupon can be redeemed for the current shopper. Resolves on
 * success (redeemable); the mutation enters `isError` when the coupon is not
 * redeemable. Uses the browser auth context (customer if logged in, else
 * anonymous) — never the service token.
 */
export function useValidateCoupon(): UseMutationResult<void, unknown, CouponActionVars> {
  const { client } = useEmporix();
  const { ctx } = useReadAuth();
  return useMutation({
    mutationFn: ({ code, redemption }: CouponActionVars) =>
      client.coupons.validateCoupon(code, redemption, ctx),
  });
}

/**
 * Redeem a coupon for the current shopper (creates a redemption). Invalidates
 * the `["emporix", "coupons"]` cache on success.
 */
export function useRedeemCoupon(): UseMutationResult<RedemptionCreated, unknown, CouponActionVars> {
  const { client } = useEmporix();
  const { ctx } = useReadAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ code, redemption }: CouponActionVars) =>
      client.coupons.redeemCoupon(code, redemption, ctx),
    onSuccess: () => void qc.invalidateQueries({ queryKey: INVALIDATE_KEY }),
  });
}
```

- [ ] **Step 4: Re-export the hooks**

In `packages/react/src/hooks/index.ts`, add (next to the other hook exports):

```ts
export { useValidateCoupon, useRedeemCoupon } from "./use-coupons";
export type { CouponActionVars } from "./use-coupons";
```

In `packages/react/src/index.ts`, add `useValidateCoupon` and `useRedeemCoupon`
to the `export { … } from "./hooks/index";` block (after `useAvailabilities`),
and `CouponActionVars` to the following `export type { … }` block.

- [ ] **Step 5: Run test + typecheck**

```bash
pnpm -F @viu/emporix-sdk-react exec vitest run tests/hooks/use-coupons.test.tsx
pnpm -F @viu/emporix-sdk-react test
pnpm -F @viu/emporix-sdk-react typecheck
```
Expected: hook tests PASS; full react suite PASS; typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/hooks/use-coupons.ts packages/react/src/hooks/index.ts packages/react/src/index.ts packages/react/tests/hooks/use-coupons.test.tsx
git commit -m "feat(react): add useValidateCoupon and useRedeemCoupon"
```

---

## Task 6: Documentation

**Files:**
- Create: `docs/coupon.md`
- Modify: `docs/react.md`, `CLAUDE.md`

- [ ] **Step 1: Write the usage doc**

Create `docs/coupon.md`:

````markdown
# Coupon Service

Bindings for the Emporix **Coupon Service** (`/coupon/{tenant}/…`): coupon CRUD,
validation, redemptions, and referral coupons.

> **Mixed audience.** Admin CRUD requires the `coupon.coupon_manage` scope
> (service token). Validation / redemption / referral can be customer-driven
> (`coupon.coupon_redeem`) or on-behalf (`coupon.coupon_redeem_on_behalf`).
> Every SDK method defaults to the **service token**; pass `auth.customer(token)`
> for customer-driven calls. Never expose the service token to a browser — use
> the React hooks (below) for storefront validate/redeem.

## Admin CRUD — `client.coupons` (server-side)

```ts
const list = await client.coupons.listCoupons({ pageSize: 20 });
const c = await client.coupons.getCoupon("SUMMER");
await client.coupons.createCoupon({ code: "SUMMER", /* … */ });
await client.coupons.updateCoupon("SUMMER", { /* … */ });
await client.coupons.patchCoupon("SUMMER", { name: "Renamed" });
await client.coupons.deleteCoupon("SUMMER");
```

## Validation & redemption

```ts
// resolves if redeemable, throws otherwise
await client.coupons.validateCoupon("SUMMER", { orderCode: "O-1001" }, auth.customer(token));

// redeem → 201 with the created redemption's location/id
const created = await client.coupons.redeemCoupon("SUMMER", { orderCode: "O-1001" }, auth.customer(token));

const redemptions = await client.coupons.listRedemptions("SUMMER");
const one = await client.coupons.getRedemption("SUMMER", "r1");
await client.coupons.deleteRedemption("SUMMER", "r1");
```

`customerNumber` in a redemption body is only honored with the
`coupon.coupon_redeem_on_behalf` scope.

## Referral coupons

```ts
const ref = await client.coupons.getReferralCoupon("C0123456789");
await client.coupons.createReferralCoupon("C0123456789");
```

## React hooks (storefront)

```tsx
import { useValidateCoupon, useRedeemCoupon } from "@viu/emporix-sdk-react";

const validate = useValidateCoupon();
const redeem = useRedeemCoupon();

await validate.mutateAsync({ code: "SUMMER", redemption: { orderCode: cart.id } });
if (validate.isSuccess) {
  await redeem.mutateAsync({ code: "SUMMER", redemption: { orderCode: cart.id } });
}
```

Both hooks use the browser auth context (customer if logged in, else anonymous)
— never the service token.
````

- [ ] **Step 2: Mention the hooks in `docs/react.md`**

Add a short "Coupons" subsection to `docs/react.md` listing `useValidateCoupon`
and `useRedeemCoupon` with the snippet above (mutation hooks; browser auth).

- [ ] **Step 3: Update CLAUDE.md service list**

In `CLAUDE.md`, append `Coupon` to the `packages/sdk` row's service list:

```
…, AI, Tax, Coupon) | yes (`@viu/emporix-sdk`) |
```

- [ ] **Step 4: Commit**

```bash
git add docs/coupon.md docs/react.md CLAUDE.md
git commit -m "docs(sdk): document the coupon service and hooks"
```

---

## Task 7: Changeset

**Files:**
- Create: `.changeset/coupon-service.md`

- [ ] **Step 1: Write the changeset (both packages)**

Create `.changeset/coupon-service.md`:

```markdown
---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add Emporix Coupon Service bindings via `client.coupons`: coupon CRUD
(`listCoupons`, `getCoupon`, `createCoupon`, `updateCoupon`, `patchCoupon`,
`deleteCoupon`), validation (`validateCoupon`), redemptions (`listRedemptions`,
`redeemCoupon`, `getRedemption`, `deleteRedemption`), and referral coupons
(`getReferralCoupon`, `createReferralCoupon`). Methods default to the service
token and are auth-overridable. Adds React hooks `useValidateCoupon` and
`useRedeemCoupon` for storefront validate/redeem (browser auth context).
```

- [ ] **Step 2: Verify**

Run: `pnpm changeset status`
Expected: `@viu/emporix-sdk` and `@viu/emporix-sdk-react` both bumped minor.

- [ ] **Step 3: Commit**

```bash
git add .changeset/coupon-service.md
git commit -m "chore(release): add coupon service changeset"
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

- **Spec coverage:** D1 full scope (13 ops) → all 13 methods in Task 3 + tests. D2 one service `client.coupons` → Task 4. D3 service-token default, overridable → `const SERVICE` default on every method; React hooks pass the browser ctx as the override (Task 5). D4 React hooks `useValidateCoupon`/`useRedeemCoupon` → Task 5 + exports + react test. D5 codegen + thin aliases → Tasks 1+2. D6 quirks: `validateCoupon` no-body → `Promise<void>`, asserted; `redeemCoupon` 201 resource-location, asserted; PATCH merge body, asserted; `customerNumber`/on-behalf documented. Docs/changeset → Tasks 6/7 (changeset bumps both packages). No gaps.
- **Placeholder scan:** No TBD/TODO. Every code step has full code. Upstream-dependent uncertainties (generated names, create/update/patch response shapes) are concrete `grep`/note verifications with fallbacks, not placeholders.
- **Type consistency:** Public names `Coupon`/`CouponList`/`CouponInput`/`CouponUpdate`/`Redemption`/`RedemptionInput`/`RedemptionCreated`/`ReferralCoupon` are identical across Task 2 (defs), Task 3 (imports + re-exports), and the tests. `RedemptionInput`/`RedemptionCreated` are imported by the React hook from `@viu/emporix-sdk` (surfaced via the coupon facade re-export — requires the Task 4 build before Task 5). Method names match across Task 3, the wiring test, the hooks, and the docs. Base path `/coupon/${tenant}` matches the spec and the test `BASE`. Logger `"coupon"` matches `mk("coupon")` and the `ServiceName` addition. `CouponActionVars` is exported from both the hook file and the package roots. Commit scopes are `sdk`/`react`/`release` with lowercase verbs (commitlint-safe).
```
