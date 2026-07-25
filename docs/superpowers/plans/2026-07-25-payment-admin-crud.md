# Payment Admin CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the 11 missing payment operations to `PaymentGatewayService` — payment-mode configuration CRUD (`payments.modes`) and the backend transaction lifecycle plus reads (`payments.transactions`) — completing coverage of `packages/sdk/specs/payment.yml`.

**Architecture:** Extend the existing `PaymentGatewayService` with two `readonly x = {…}` sub-resources of arrow functions. All new methods default to a new `SERVICE` auth const (overridable via the trailing `authCtx`). Public types alias generated types 1:1, except `PaymentCaptureResult`, which the spec declares inline. No client wiring, no constructor change.

**Tech Stack:** TypeScript, Vitest (`vi.fn()`-mocked `http.request`), `@hey-api/openapi-ts`-generated types under `src/generated/payment`.

## Global Constraints

- Package: `@viu/emporix-sdk`. Release bump: **minor** (additive).
- HTTP: `this.ctx.http.request<T>({ method, path, query?, body?, auth })`. Paths are written inline: `` `/payment-gateway/${this.ctx.tenant}/…` `` (this service has no `base()` helper).
- Auth: `const ANON: AuthContext = auth.anonymous()` already exists at line 11. Add `const SERVICE: AuthContext = auth.service()` beside it (the `auth` helper is already imported on line 2). Every new method ends with `authCtx: AuthContext = SERVICE`.
- The parameter is named **`authCtx`** in this file (not `auth`) — `auth` is the imported helper module, so shadowing it would break `auth.service()`.
- Commitlint: scope `payment` is allowed; subject's first word must be a lowercase verb.
- Do NOT modify the existing methods (`listPaymentModes`, `getMode`, `authorize`, `initialize`) or the hand-written `AuthorizePaymentResult` interface.
- `create`/`update` on modes respond **200** with the full object (not 201/204). Payment endpoints signal business failure inside the 200 body (`successful: false`), so no special error handling is added.

## File Structure

- **Modify** `packages/sdk/src/services/payment.ts` — extend the generated-type import (lines 4-9), add the `SERVICE` const, add 9 public type aliases, add the `modes` and `transactions` sub-resources at the end of the class (the class's closing `}` is at line 88).
- **Modify** `packages/sdk/src/index.ts:116-122` — extend the `./services/payment` type export.
- **Create** `packages/sdk/tests/services/payment-admin.test.ts` — `vi.fn()`-mocked path/method/auth assertions.
- **Create** `.changeset/payment-admin-crud.md` — minor changeset.

---

### Task 1: Types + `payments.modes` config CRUD

**Files:**
- Modify: `packages/sdk/src/services/payment.ts` (import block lines 4-9; `SERVICE` const after line 11; aliases after line 34; `modes` member appended before the class's closing `}` on line 88)
- Modify: `packages/sdk/src/index.ts` (the `./services/payment` type-export block, lines 116-122)
- Test: `packages/sdk/tests/services/payment-admin.test.ts` (create)

**Interfaces:**
- Consumes: existing `PaymentGatewayService(ctx)`, `auth` helper, `AuthContext`.
- Produces (all 9 aliases, so Task 2 and the index edit happen once):
  - `type PaymentModeConfig`, `PaymentModeCreateInput`, `PaymentModeUpdateInput`, `PaymentTransaction`, `PaymentAuthorizeResult`, `PaymentCaptureInput`, `PaymentRefundInput`, `PaymentActionResult`, `PaymentCaptureResult`
  - `readonly modes` with `list`, `get`, `create`, `update`, `delete` (exact signatures in Step 5)

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/payment-admin.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { PaymentGatewayService } from "../../src/services/payment";

function ctxWith(request: ReturnType<typeof vi.fn>): ConstructorParameters<typeof PaymentGatewayService>[0] {
  return {
    tenant: "acme",
    http: { request },
    tokenProvider: { getToken: vi.fn() },
    logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}
const svc = (req: ReturnType<typeof vi.fn>): PaymentGatewayService => new PaymentGatewayService(ctxWith(req));
const C = "/payment-gateway/acme/paymentmodes/config";
const P = "/payment-gateway/acme/payment";
const TX = "/payment-gateway/acme/transactions";

describe("PaymentGatewayService.modes", () => {
  it("config CRUD hits the right method+path with SERVICE default", async () => {
    const l = vi.fn().mockResolvedValue([{ id: "m1" }]);
    await svc(l).modes.list();
    expect(l).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: C, auth: { kind: "service" } }));

    const g = vi.fn().mockResolvedValue({ id: "m1" });
    await svc(g).modes.get("m1");
    expect(g).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: `${C}/m1`, auth: { kind: "service" } }));

    const c = vi.fn().mockResolvedValue({ id: "m1" });
    await svc(c).modes.create({} as never);
    expect(c).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: C, body: {}, auth: { kind: "service" } }));

    const u = vi.fn().mockResolvedValue({ id: "m1" });
    await svc(u).modes.update("m1", {} as never);
    expect(u).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: `${C}/m1`, body: {}, auth: { kind: "service" } }));

    const d = vi.fn().mockResolvedValue(undefined);
    await svc(d).modes.delete("m1");
    expect(d).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: `${C}/m1`, auth: { kind: "service" } }));
  });

  it("sends no query on the config list (the endpoint takes none)", async () => {
    const l = vi.fn().mockResolvedValue([]);
    await svc(l).modes.list();
    expect(l.mock.calls[0]?.[0]).not.toHaveProperty("query");
  });

  it("honors an explicit auth override", async () => {
    const l = vi.fn().mockResolvedValue([]);
    await svc(l).modes.list({ kind: "raw", token: "X" });
    expect(l).toHaveBeenCalledWith(expect.objectContaining({ auth: { kind: "raw", token: "X" } }));
  });
});
```

(`P` and `TX` are used by Task 2's block appended to the same file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk test -- payment-admin`
Expected: FAIL — `modes` is undefined ("Cannot read properties of undefined").

- [ ] **Step 3: Extend the generated-type import**

In `packages/sdk/src/services/payment.ts`, replace the import block (lines 4-9):

```ts
import type {
  PaymentModeFrontendResponse,
  AuthorizePaymentRequest,
  InitializePaymentRequest,
  InitializePaymentResponse,
} from "../generated/payment";
```

with:

```ts
import type {
  PaymentModeFrontendResponse,
  AuthorizePaymentRequest,
  InitializePaymentRequest,
  InitializePaymentResponse,
  PaymentModeResponse,
  PaymentModeRequest,
  PaymentMethodUpdateRequest,
  PaymentTransactionResponse,
  AuthorizePaymentResponse,
  CaptureRequest,
  RefundRequest,
  CommonPaymentResponse,
} from "../generated/payment";
```

- [ ] **Step 4: Add the SERVICE const and the type aliases**

In `payment.ts`, replace line 11:

```ts
const ANON: AuthContext = auth.anonymous();
```

with:

```ts
const ANON: AuthContext = auth.anonymous();
const SERVICE: AuthContext = auth.service();
```

Then, after the `AuthorizePaymentResult` interface (which closes with `}` on line 34), add:

```ts
/** A configured payment mode (admin view, `/paymentmodes/config`). */
export type PaymentModeConfig = PaymentModeResponse;

/** Body for creating a payment-mode configuration. */
export type PaymentModeCreateInput = PaymentModeRequest;

/** Body for updating a payment-mode configuration. */
export type PaymentModeUpdateInput = PaymentMethodUpdateRequest;

/** A payment transaction (generated). */
export type PaymentTransaction = PaymentTransactionResponse;

/** Result of a backend payment authorization. */
export type PaymentAuthorizeResult = AuthorizePaymentResponse;

/** Body for capturing an authorized payment. */
export type PaymentCaptureInput = CaptureRequest;

/** Body for refunding a captured payment. */
export type PaymentRefundInput = RefundRequest;

/**
 * Result of a refund/cancel operation. Business failures are reported in the
 * body (`successful: false` + `message`), not via HTTP status.
 */
export type PaymentActionResult = CommonPaymentResponse;

/** Result of a capture — like {@link PaymentActionResult} plus the provider's capture id. */
export type PaymentCaptureResult = {
  successful?: boolean;
  message?: string;
  captureId?: string;
};
```

- [ ] **Step 5: Add the `modes` sub-resource**

In `payment.ts`, append this member inside the `PaymentGatewayService` class — after `initialize` and before the class's closing `}` (line 88):

```ts
  /**
   * Payment-mode **configuration** (`/paymentmodes/config`) — the admin view.
   * For the storefront view use {@link listPaymentModes} / {@link getMode}.
   * Defaults to service auth.
   */
  readonly modes = {
    /** Lists all configured payment modes. The endpoint takes no query parameters. */
    list: async (authCtx: AuthContext = SERVICE): Promise<PaymentModeConfig[]> =>
      this.ctx.http.request<PaymentModeConfig[]>({
        method: "GET",
        path: `/payment-gateway/${this.ctx.tenant}/paymentmodes/config`,
        auth: authCtx,
      }),

    /** Retrieves one payment-mode configuration by id. */
    get: async (id: string, authCtx: AuthContext = SERVICE): Promise<PaymentModeConfig> =>
      this.ctx.http.request<PaymentModeConfig>({
        method: "GET",
        path: `/payment-gateway/${this.ctx.tenant}/paymentmodes/config/${id}`,
        auth: authCtx,
      }),

    /** Creates a payment-mode configuration. Responds 200 with the created mode. */
    create: async (
      input: PaymentModeCreateInput,
      authCtx: AuthContext = SERVICE,
    ): Promise<PaymentModeConfig> =>
      this.ctx.http.request<PaymentModeConfig>({
        method: "POST",
        path: `/payment-gateway/${this.ctx.tenant}/paymentmodes/config`,
        body: input,
        auth: authCtx,
      }),

    /** Updates a payment-mode configuration (PUT). Responds 200 with the updated mode. */
    update: async (
      id: string,
      input: PaymentModeUpdateInput,
      authCtx: AuthContext = SERVICE,
    ): Promise<PaymentModeConfig> =>
      this.ctx.http.request<PaymentModeConfig>({
        method: "PUT",
        path: `/payment-gateway/${this.ctx.tenant}/paymentmodes/config/${id}`,
        body: input,
        auth: authCtx,
      }),

    /** Deletes a payment-mode configuration. */
    delete: async (id: string, authCtx: AuthContext = SERVICE): Promise<void> => {
      await this.ctx.http.request<void>({
        method: "DELETE",
        path: `/payment-gateway/${this.ctx.tenant}/paymentmodes/config/${id}`,
        auth: authCtx,
      });
    },
  };
```

- [ ] **Step 6: Export the new types**

In `packages/sdk/src/index.ts`, replace the `./services/payment` type export (lines 116-122):

```ts
export type {
  PaymentMode,
  AuthorizePaymentInput,
  AuthorizePaymentResult,
  InitializePaymentInput,
  InitializePaymentResult,
} from "./services/payment";
```

with:

```ts
export type {
  PaymentMode,
  AuthorizePaymentInput,
  AuthorizePaymentResult,
  InitializePaymentInput,
  InitializePaymentResult,
  PaymentModeConfig,
  PaymentModeCreateInput,
  PaymentModeUpdateInput,
  PaymentTransaction,
  PaymentAuthorizeResult,
  PaymentCaptureInput,
  PaymentRefundInput,
  PaymentActionResult,
  PaymentCaptureResult,
} from "./services/payment";
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk test -- payment-admin`
Expected: PASS (3 tests).

- [ ] **Step 8: Typecheck**

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add packages/sdk/src/services/payment.ts packages/sdk/src/index.ts packages/sdk/tests/services/payment-admin.test.ts
git commit -m "feat(payment): add payment mode config crud"
```

---

### Task 2: `payments.transactions` lifecycle + reads

**Files:**
- Modify: `packages/sdk/src/services/payment.ts` (`transactions` member appended after `modes`)
- Test: `packages/sdk/tests/services/payment-admin.test.ts` (append a describe block)

**Interfaces:**
- Consumes: the aliases from Task 1, `SERVICE`, `AuthorizePaymentInput` (already public), `this.ctx`.
- Produces: `readonly transactions` with:
  - `list(params?: { pageNumber?: number; pageSize?: number; sort?: string }, authCtx?: AuthContext): Promise<PaymentTransaction[]>`
  - `get(transactionId: string, authCtx?: AuthContext): Promise<PaymentTransaction>`
  - `authorize(input: AuthorizePaymentInput, authCtx?: AuthContext): Promise<PaymentAuthorizeResult>`
  - `capture(transactionId: string, input?: PaymentCaptureInput, authCtx?: AuthContext): Promise<PaymentCaptureResult>`
  - `refund(transactionId: string, input?: PaymentRefundInput, authCtx?: AuthContext): Promise<PaymentActionResult>`
  - `cancel(transactionId: string, authCtx?: AuthContext): Promise<PaymentActionResult>`

- [ ] **Step 1: Write the failing test**

Append to `packages/sdk/tests/services/payment-admin.test.ts`:

```ts
describe("PaymentGatewayService.transactions", () => {
  it("reads hit the transaction paths and forward paging", async () => {
    const l = vi.fn().mockResolvedValue([{ id: "t1" }]);
    await svc(l).transactions.list({ pageSize: 10, sort: "created:desc" });
    expect(l).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: TX,
        auth: { kind: "service" },
        query: expect.objectContaining({ pageSize: 10, sort: "created:desc" }),
      }),
    );

    const bare = vi.fn().mockResolvedValue([]);
    await svc(bare).transactions.list();
    expect(bare.mock.calls[0]?.[0]).not.toHaveProperty("query");

    const g = vi.fn().mockResolvedValue({ id: "t1" });
    await svc(g).transactions.get("t1");
    expect(g).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: `${TX}/t1`, auth: { kind: "service" } }));
  });

  it("authorize POSTs the backend authorize path", async () => {
    const a = vi.fn().mockResolvedValue({ successful: true });
    await svc(a).transactions.authorize({} as never);
    expect(a).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: `${P}/authorize`, body: {}, auth: { kind: "service" } }));
  });

  it("capture/refund send a body only when given; cancel never does", async () => {
    const c = vi.fn().mockResolvedValue({ successful: true, captureId: "c1" });
    const res = await svc(c).transactions.capture("t1", { amount: 10, currency: "CHF" });
    expect(c).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST", path: `${P}/t1/capture`, body: { amount: 10, currency: "CHF" }, auth: { kind: "service" } }),
    );
    expect(res).toEqual({ successful: true, captureId: "c1" });

    const cb = vi.fn().mockResolvedValue({ successful: true });
    await svc(cb).transactions.capture("t1");
    expect(cb.mock.calls[0]?.[0]).not.toHaveProperty("body");

    const r = vi.fn().mockResolvedValue({ successful: true });
    await svc(r).transactions.refund("t1", { amount: 5 });
    expect(r).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: `${P}/t1/refund`, body: { amount: 5 } }));

    const rb = vi.fn().mockResolvedValue({ successful: true });
    await svc(rb).transactions.refund("t1");
    expect(rb.mock.calls[0]?.[0]).not.toHaveProperty("body");

    const x = vi.fn().mockResolvedValue({ successful: true });
    await svc(x).transactions.cancel("t1");
    expect(x).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: `${P}/t1/cancel`, auth: { kind: "service" } }));
    expect(x.mock.calls[0]?.[0]).not.toHaveProperty("body");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk test -- payment-admin`
Expected: FAIL — `transactions` is undefined.

- [ ] **Step 3: Add the `transactions` sub-resource**

In `payment.ts`, append this member inside the `PaymentGatewayService` class after `modes` (from Task 1) and before the class's closing `}`:

```ts
  /**
   * Backend transaction lifecycle and reads. `authorize` creates the transaction
   * that `capture`/`refund`/`cancel` then act on. Business failures are reported
   * in the response body (`successful: false`), not as HTTP errors — always check
   * `successful`. Defaults to service auth.
   */
  readonly transactions = {
    /** One page of payment transactions. */
    list: async (
      params: { pageNumber?: number; pageSize?: number; sort?: string } = {},
      authCtx: AuthContext = SERVICE,
    ): Promise<PaymentTransaction[]> => {
      const query = {
        ...(params.pageNumber === undefined ? {} : { pageNumber: params.pageNumber }),
        ...(params.pageSize === undefined ? {} : { pageSize: params.pageSize }),
        ...(params.sort === undefined ? {} : { sort: params.sort }),
      };
      return this.ctx.http.request<PaymentTransaction[]>({
        method: "GET",
        path: `/payment-gateway/${this.ctx.tenant}/transactions`,
        ...(Object.keys(query).length > 0 ? { query } : {}),
        auth: authCtx,
      });
    },

    /** Retrieves one payment transaction by id. */
    get: async (transactionId: string, authCtx: AuthContext = SERVICE): Promise<PaymentTransaction> =>
      this.ctx.http.request<PaymentTransaction>({
        method: "GET",
        path: `/payment-gateway/${this.ctx.tenant}/transactions/${transactionId}`,
        auth: authCtx,
      }),

    /**
     * Authorizes a payment as a backend caller (`POST /payment/authorize`). The
     * storefront equivalent is {@link PaymentGatewayService.authorize}, which
     * targets `/payment/frontend/authorize` with a customer token.
     */
    authorize: async (
      input: AuthorizePaymentInput,
      authCtx: AuthContext = SERVICE,
    ): Promise<PaymentAuthorizeResult> =>
      this.ctx.http.request<PaymentAuthorizeResult>({
        method: "POST",
        path: `/payment-gateway/${this.ctx.tenant}/payment/authorize`,
        body: input,
        auth: authCtx,
      }),

    /**
     * Captures an authorized payment. Omit `input` to capture the full
     * authorized amount. Returns the provider's `captureId` on success.
     */
    capture: async (
      transactionId: string,
      input?: PaymentCaptureInput,
      authCtx: AuthContext = SERVICE,
    ): Promise<PaymentCaptureResult> =>
      this.ctx.http.request<PaymentCaptureResult>({
        method: "POST",
        path: `/payment-gateway/${this.ctx.tenant}/payment/${transactionId}/capture`,
        ...(input === undefined ? {} : { body: input }),
        auth: authCtx,
      }),

    /**
     * Refunds a captured payment. Omit `input` to refund the full captured
     * amount; pass `captureId` when several captures exist for the payment.
     */
    refund: async (
      transactionId: string,
      input?: PaymentRefundInput,
      authCtx: AuthContext = SERVICE,
    ): Promise<PaymentActionResult> =>
      this.ctx.http.request<PaymentActionResult>({
        method: "POST",
        path: `/payment-gateway/${this.ctx.tenant}/payment/${transactionId}/refund`,
        ...(input === undefined ? {} : { body: input }),
        auth: authCtx,
      }),

    /** Cancels an authorized payment. Takes no body. */
    cancel: async (transactionId: string, authCtx: AuthContext = SERVICE): Promise<PaymentActionResult> =>
      this.ctx.http.request<PaymentActionResult>({
        method: "POST",
        path: `/payment-gateway/${this.ctx.tenant}/payment/${transactionId}/cancel`,
        auth: authCtx,
      }),
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk test -- payment-admin`
Expected: PASS (6 tests total).

- [ ] **Step 5: Typecheck**

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/services/payment.ts packages/sdk/tests/services/payment-admin.test.ts
git commit -m "feat(payment): add backend transaction lifecycle and reads"
```

---

### Task 3: Changeset + full verification

**Files:**
- Create: `.changeset/payment-admin-crud.md`

**Interfaces:**
- Consumes: nothing new.
- Produces: the release changeset; a green full test/typecheck/build run.

- [ ] **Step 1: Write the changeset**

Create `.changeset/payment-admin-crud.md`:

```md
---
"@viu/emporix-sdk": minor
---

Add the payment admin surface to `client.payments`. New `payments.modes`
sub-resource for payment-mode configuration (`list`/`get`/`create`/`update`/`delete`
against `/paymentmodes/config`), and new `payments.transactions` sub-resource for
the backend lifecycle: `list`, `get`, `authorize` (backend counterpart of the
storefront `authorize`), `capture`, `refund`, and `cancel`. All new methods
default to service auth. Note that these endpoints report business failures in
the 200 response body (`successful: false`), not as HTTP errors. The existing
storefront methods are unchanged.
```

- [ ] **Step 2: Run the full SDK unit suite**

Run: `pnpm -F @viu/emporix-sdk test`
Expected: PASS (existing suite + the new `payment-admin` tests).

- [ ] **Step 3: Repo-wide typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Build the SDK**

Run: `pnpm -F @viu/emporix-sdk build`
Expected: `dist/` written, no errors.

- [ ] **Step 5: Commit**

```bash
git add .changeset/payment-admin-crud.md
git commit -m "chore(payment): add changeset for payment admin crud"
```

---

## Self-Review

**Spec coverage** — every spec operation maps to a task:

| Spec operation | Task |
|---|---|
| `modes.list` (GET /paymentmodes/config) | 1 |
| `modes.get` (GET /paymentmodes/config/{id}) | 1 |
| `modes.create` (POST /paymentmodes/config) | 1 |
| `modes.update` (PUT /paymentmodes/config/{id}) | 1 |
| `modes.delete` (DELETE /paymentmodes/config/{id}) | 1 |
| `transactions.list` (GET /transactions) | 2 |
| `transactions.get` (GET /transactions/{transactionId}) | 2 |
| `transactions.authorize` (POST /payment/authorize) | 2 |
| `transactions.capture` (POST /payment/{transactionId}/capture) | 2 |
| `transactions.refund` (POST /payment/{transactionId}/refund) | 2 |
| `transactions.cancel` (POST /payment/{transactionId}/cancel) | 2 |
| 9 type aliases + index exports | 1 |
| Changeset (minor) | 3 |

11 operations = the full gap. The 4 storefront methods stay untouched. ✓

**Placeholder scan:** no TBD/TODO; every code step shows complete code. ✓

**Type consistency:** sub-resource keys in the tests match the implementations (`modes.{list,get,create,update,delete}`, `transactions.{list,get,authorize,capture,refund,cancel}`). All 9 aliases are declared and index-exported in Task 1 before Task 2 consumes them. Generated import names verified against `src/generated/payment/types.gen.ts` (`PaymentModeResponse`, `PaymentModeRequest`, `PaymentMethodUpdateRequest`, `PaymentTransactionResponse`, `AuthorizePaymentResponse`, `CaptureRequest`, `RefundRequest`, `CommonPaymentResponse`). `PaymentCaptureResult` is declared inline in `payment.ts` because the spec has no named type for it. ✓

**Naming-collision check:** the parameter is `authCtx` everywhere (never `auth`), so the imported `auth` helper stays reachable for `auth.service()`. The new `modes.list`/`modes.get` live on the sub-resource, so they do not collide with the existing flat `listPaymentModes`/`getMode`; `transactions.authorize` does not collide with the existing flat `authorize`. ✓

**Body/query omission:** `capture`/`refund` spread `body` only when `input` is given, and `cancel` never sends one — asserted by `not.toHaveProperty("body")`. `transactions.list` omits `query` when no params are passed; `modes.list` never sends one (the endpoint declares `query?: never`). No boolean query flags exist on these endpoints, so no `String(...)` conversion is needed. ✓
