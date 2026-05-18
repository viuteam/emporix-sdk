# Emporix SDK — Plan 5: Checkout & Payment-Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `CheckoutService` (trigger checkout from a cart or a quote) and `PaymentGatewayService` (list payment modes, authorize deferred/post-checkout payments) to the core SDK, plus a generic per-request header mechanism, a React `useCheckout` hook, and a checkout step in the Next.js example.

**Architecture:** Reuse the existing facade pattern (`ClientContext` + `HttpClient`). Add `RequestOptions.headers` so the checkout call can send the mandatory `saas-token` header (from `CustomerSession.saasToken`). Checkout requires a `customer`/`raw` AuthContext (or explicit guest); the `saas-token` and `siteCode` travel per call — never stored. Vendor + codegen the two new OpenAPI specs alongside the existing four.

**Tech Stack:** Plan 1–4 core (`HttpClient`, `errors`, `logger`, `context`), `@hey-api/openapi-ts`, vitest + msw; React package + `@tanstack/react-query`.

**Validated Emporix facts (live docs, 2026-05-18):**
- `POST /checkout/{tenant}/checkouts/order?siteCode=…` — Bearer customer token + header `saas-token` (required for logged-in customer; omitted for guest). Atomic: validates → creates order → payment → closes cart.
- Body is `oneOf`:
  - `requestCheckout` (required `cartId`, `customer`, `shipping`, `addresses`, `paymentMethods`); `customer.email` required, `customer.guest=true` for guest, `customer.id` for logged-in; `addresses` ≥2 with one `SHIPPING` + one `BILLING`; exactly one `paymentMethods` entry; `provider ∈ payment-gateway|custom|none`.
  - `requestFromQuoteCheckout` (required `quoteId`, `paymentMethods`; optional `deliveryWindowId`).
- Response `{ orderId, paymentDetails: object|null, checkoutId: string|null }`. Errors: 400 validation (detailed), 401, 403, **409** (delivery-window capacity / duplicate order for `cartId`), 500.
- Post-checkout deferred payment: `paymentMethods:[{ provider:"payment-gateway", customAttributes:{ customer, deferred:true } }]` → order placed, then `POST /payment-gateway/{tenant}/payment/frontend/authorize` with `{ order:{id}, paymentModeId, creditCardToken? }` → `{ successful, paymentTransactionId, authorizationToken, requiresExternalPayment, externalPaymentRedirectURL?, externalPaymentHttpMethod? }`.
- Payment modes: `GET /payment-gateway/{tenant}/paymentmodes/frontend`.
- Public raw specs (no auth):
  - checkout: `https://raw.githubusercontent.com/emporix/api-references/refs/heads/main/checkout/checkout/api-reference/api.yml`
  - payment-gateway: `https://raw.githubusercontent.com/emporix/api-references/refs/heads/main/checkout/payment-gateway/api-reference/api.yml`
- Source-of-truth rule: vendored YAML wins; facade maps idiomatic names with a code comment.

---

## File Structure (this plan)

```
packages/sdk/src/core/http.ts             + RequestOptions.headers (merged into fetch headers)
packages/sdk/src/core/logger.ts           + "saas-token" in DEFAULT_REDACT
packages/sdk/scripts/fetch-specs.ts       + checkout, payment specs
packages/sdk/specs/{checkout,payment}.yml vendored, committed
packages/sdk/src/generated/{checkout,payment}/*  AUTO-GENERATED
packages/sdk/src/services/checkout.ts     CheckoutService facade
packages/sdk/src/services/payment.ts      PaymentGatewayService facade
packages/sdk/src/client.ts                + sdk.checkout, sdk.payments
packages/sdk/src/index.ts                 + checkout/payment exports
packages/sdk/src/checkout.ts packages/sdk/src/payment.ts   subpath barrels
packages/sdk/package.json packages/sdk/tsup.config.ts      + subpath exports/entries
packages/sdk/tests/{http-headers,services/checkout,services/payment}.test.ts
packages/react/src/hooks/use-checkout.ts  useCheckout + usePaymentModes
packages/react/src/hooks/index.ts packages/react/src/index.ts  + exports
packages/react/tests/use-checkout.test.tsx
examples/next-app-router/app/checkout/page.tsx   checkout step
docs/checkout.md                          checkout + payment guide
.changeset/checkout.md
```

`ServiceName` gains `checkout` and `payment` (logger per-service control).

---

## Task 1: Core — generic per-request headers + saas-token redaction

**Files:**
- Modify: `packages/sdk/src/core/http.ts`, `packages/sdk/src/core/logger.ts`
- Test: `packages/sdk/tests/http-headers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http as mhttp, HttpResponse } from "msw";
import { HttpClient } from "../src/core/http";
import { LevelResolver, redact } from "../src/core/logger";
import { MemoryLogger } from "./helpers/memory-logger";
import type { TokenProvider } from "../src/core/auth";

const provider: TokenProvider = {
  getToken: async () => "SVC",
  getAnonymousToken: async () => ({
    accessToken: "ANON", refreshToken: "r", sessionId: "s", expiresIn: 3599,
  }),
};

let seen: Record<string, string | null> = {};
const server = setupServer(
  mhttp.post("https://api.emporix.io/echo", ({ request }) => {
    seen = {
      auth: request.headers.get("authorization"),
      saas: request.headers.get("saas-token"),
    };
    return HttpResponse.json({ ok: true });
  }),
);
beforeAll(() => server.listen());
afterEach(() => { server.resetHandlers(); seen = {}; });
afterAll(() => server.close());

function client() {
  const r = new LevelResolver({ level: "silent" });
  return new HttpClient({
    host: "https://api.emporix.io",
    provider,
    logger: new MemoryLogger(r, { service: "checkout" }),
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
}

describe("HttpClient custom headers", () => {
  it("merges RequestOptions.headers into the request", async () => {
    await client().request({
      method: "POST",
      path: "/echo",
      auth: { kind: "customer", token: "CUST" },
      headers: { "saas-token": "SAAS-JWT" },
      body: {},
    });
    expect(seen.auth).toBe("Bearer CUST");
    expect(seen.saas).toBe("SAAS-JWT");
  });
});

describe("redact", () => {
  it("masks the saas-token header key", () => {
    expect(redact({ "saas-token": "SAAS-JWT", keep: 1 })).toEqual({
      "saas-token": "***redacted***",
      keep: 1,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/http-headers.test.ts`
Expected: FAIL — `headers` not applied; `saas-token` not redacted.

- [ ] **Step 3: Add `headers` to `RequestOptions` and merge them**

In `packages/sdk/src/core/http.ts`, add to the `RequestOptions` interface:

```ts
  /** Extra request headers (merged after auth/content-type; values may be sensitive). */
  headers?: Record<string, string>;
```

In the `request` method, where the fetch `init.headers` object is built, spread
`o.headers` last so callers can add headers (but never override `Authorization`
— spread `o.headers` BEFORE the `Authorization` line so auth always wins):

```ts
      const init: RequestInit = {
        method: o.method,
        headers: {
          ...(o.headers ?? {}),
          Authorization: `Bearer ${token}`,
          ...(o.body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        signal: controller.signal,
      };
```

- [ ] **Step 4: Add `saas-token` to the redaction floor**

In `packages/sdk/src/core/logger.ts`, add `"saas-token"` to the
`DEFAULT_REDACT` set (next to `"saastoken"`).

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/http-headers.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/core/http.ts packages/sdk/src/core/logger.ts packages/sdk/tests/http-headers.test.ts
git commit -m "feat(http): support per-request headers and redact saas-token"
```

---

## Task 2: Vendor checkout + payment specs, regenerate types

**Files:**
- Modify: `packages/sdk/scripts/fetch-specs.ts`
- Create: `packages/sdk/specs/checkout.yml`, `packages/sdk/specs/payment.yml`, `packages/sdk/src/generated/checkout/*`, `packages/sdk/src/generated/payment/*`

- [ ] **Step 1: Add the two specs to `fetch-specs.ts`**

In the `SPECS` map add:

```ts
  checkout: `${BASE}/checkout/checkout/api-reference/api.yml`,
  payment: `${BASE}/checkout/payment-gateway/api-reference/api.yml`,
```

- [ ] **Step 2: Fetch + generate**

Run: `pnpm --filter @viu/emporix-sdk fetch:specs`
Expected: prints six `fetched …` lines incl. `checkout`, `payment`;
`packages/sdk/specs/checkout.yml` and `payment.yml` exist.
Run: `pnpm --filter @viu/emporix-sdk generate`
Expected: prints `generated checkout` and `generated payment`;
`src/generated/checkout/` and `src/generated/payment/` populated, banner-prefixed.

- [ ] **Step 3: Verify generated types compile**

Run: `pnpm --filter @viu/emporix-sdk exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit (vendored specs + generated code committed for determinism)**

```bash
git add packages/sdk/scripts/fetch-specs.ts packages/sdk/specs/checkout.yml packages/sdk/specs/payment.yml packages/sdk/src/generated/checkout packages/sdk/src/generated/payment
git commit -m "feat(sdk): vendor checkout + payment-gateway specs and generate types"
```

---

## Task 3: CheckoutService facade

**Files:**
- Create: `packages/sdk/src/services/checkout.ts`
- Test: `packages/sdk/tests/services/checkout.test.ts`

Endpoint: `POST /checkout/{tenant}/checkouts/order` (+ `?siteCode`).
Auth: `customer`/`raw` required for logged-in; guest allowed when
`input.customer.guest === true` (then no `saas-token`). `saasToken` passed via
opts → `saas-token` header. Body is the caller-supplied `requestCheckout` or
`requestFromQuoteCheckout` shape (typed from generated schemas; facade exposes
idiomatic wrappers).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { CheckoutService } from "../../src/services/checkout";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";
import { EmporixAuthError, EmporixError } from "../../src/core/errors";

let captured: { auth: string | null; saas: string | null; url: string; body: unknown } | null = null;
const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
  http.post("https://api.emporix.io/checkout/acme/checkouts/order", async ({ request }) => {
    captured = {
      auth: request.headers.get("authorization"),
      saas: request.headers.get("saas-token"),
      url: request.url,
      body: await request.json(),
    };
    return HttpResponse.json({ orderId: "EON1", paymentDetails: null, checkoutId: null });
  }),
  http.post("https://api.emporix.io/checkout/acme/checkouts/order", () =>
    HttpResponse.json({ status: 409, type: "conflict", message: "dup" }, { status: 409 }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => { server.resetHandlers(); captured = null; });
afterAll(() => server.close());

function svc() {
  const cfg = {
    tenant: "acme", host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "checkout" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io", provider: tokenProvider, logger,
    retry: { maxAttempts: 1 }, timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new CheckoutService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const order = {
  cartId: "cart1",
  currency: "EUR",
  customer: { email: "a@b.co", id: "c1", firstName: "A" },
  shipping: { methodId: "m", zoneId: "z", methodName: "DHL", amount: 0 },
  addresses: [
    { contactName: "A", street: "S", zipCode: "1", city: "B", country: "DE", type: "SHIPPING" },
    { contactName: "A", street: "S", zipCode: "1", city: "B", country: "DE", type: "BILLING" },
  ],
  paymentMethods: [{ provider: "none", method: "invoice" }],
};

describe("CheckoutService", () => {
  it("placeOrder requires a customer/raw context", async () => {
    // @ts-expect-error auth required
    await expect(svc().placeOrder(order)).rejects.toBeInstanceOf(EmporixAuthError);
  });

  it("placeOrder sends Bearer + saas-token + siteCode and returns the order", async () => {
    const res = await svc().placeOrder(
      order,
      { kind: "customer", token: "CUST" },
      { saasToken: "SAAS", siteCode: "DE" },
    );
    expect(res.orderId).toBe("EON1");
    expect(captured?.auth).toBe("Bearer CUST");
    expect(captured?.saas).toBe("SAAS");
    expect(captured?.url).toContain("siteCode=DE");
  });

  it("guest checkout omits saas-token and accepts anonymous auth", async () => {
    const guest = { ...order, customer: { email: "g@b.co", guest: true } };
    await svc().placeOrder(guest, { kind: "anonymous" });
    expect(captured?.saas).toBeNull();
  });

  it("placeOrderFromQuote posts a quote checkout", async () => {
    server.use(
      http.post("https://api.emporix.io/checkout/acme/checkouts/order", async ({ request }) => {
        const b = (await request.json()) as { quoteId?: string };
        return HttpResponse.json({ orderId: b.quoteId ? "EONQ" : "X", paymentDetails: null, checkoutId: null });
      }),
    );
    const res = await svc().placeOrderFromQuote(
      { quoteId: "q1", paymentMethods: [{ provider: "none" }] },
      { kind: "customer", token: "CUST" },
      { saasToken: "SAAS" },
    );
    expect(res.orderId).toBe("EONQ");
  });

  it("maps a 409 to a typed EmporixError", async () => {
    server.use(
      http.post("https://api.emporix.io/checkout/acme/checkouts/order", () =>
        HttpResponse.json({ status: 409, message: "dup" }, { status: 409 }),
      ),
    );
    await expect(
      svc().placeOrder(order, { kind: "customer", token: "C" }, { saasToken: "S" }),
    ).rejects.toBeInstanceOf(EmporixError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/services/checkout.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import { EmporixAuthError } from "../core/errors";

/** A checkout payment method (one only). `provider`: payment-gateway|custom|none. */
export interface CheckoutPaymentMethod {
  provider: "payment-gateway" | "custom" | "none";
  method?: string;
  amount?: number;
  customAttributes?: Record<string, unknown>;
}

/** A checkout address. Need ≥1 SHIPPING and ≥1 BILLING. */
export interface CheckoutAddress {
  contactName: string;
  street: string;
  zipCode: string;
  city: string;
  country: string;
  type: "SHIPPING" | "BILLING" | string;
  companyName?: string;
  streetNumber?: string;
  state?: string;
  contactPhone?: string;
  [k: string]: unknown;
}

/** Checkout customer block. `email` required; `guest:true` for guest checkout. */
export interface CheckoutCustomer {
  email: string;
  id?: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  contactPhone?: string;
  company?: string;
  guest?: boolean;
  [k: string]: unknown;
}

/** `requestCheckout` body (cart-based). */
export interface CheckoutInput {
  cartId: string;
  customer: CheckoutCustomer;
  shipping: {
    methodId: string;
    zoneId: string;
    methodName: string;
    amount: number;
    shippingTaxCode?: string;
  };
  addresses: CheckoutAddress[];
  paymentMethods: CheckoutPaymentMethod[];
  currency?: string;
}

/** `requestFromQuoteCheckout` body (quote-based). */
export interface QuoteCheckoutInput {
  quoteId: string;
  paymentMethods: CheckoutPaymentMethod[];
  deliveryWindowId?: string;
}

/** `responseCheckout`. `paymentDetails` is provider-shaped (kept verbatim). */
export interface CheckoutResult {
  orderId: string;
  paymentDetails: Record<string, unknown> | null;
  checkoutId: string | null;
}

/** Options for a checkout call. */
export interface CheckoutOptions {
  /** Customer `saasToken` from `customers.login()` — required for logged-in checkout. */
  saasToken?: string;
  /** Site code (`?siteCode=`). */
  siteCode?: string;
}

function isGuest(customer: CheckoutCustomer | undefined): boolean {
  return customer?.guest === true;
}

function resolveAuth(auth: AuthContext | undefined, guest: boolean): AuthContext {
  if (auth && (auth.kind === "customer" || auth.kind === "raw")) return auth;
  if (guest && auth && auth.kind === "anonymous") return auth;
  throw new EmporixAuthError(
    "checkout requires a customer/raw AuthContext (or anonymous for a guest checkout)",
  );
}

/** Triggers Emporix checkout (atomic: validate → order → payment → close cart). */
export class CheckoutService {
  constructor(private readonly ctx: ClientContext) {}

  private headers(opts: CheckoutOptions, guest: boolean): Record<string, string> | undefined {
    if (guest || !opts.saasToken) return undefined;
    return { "saas-token": opts.saasToken };
  }

  private query(opts: CheckoutOptions): Record<string, string> | undefined {
    return opts.siteCode ? { siteCode: opts.siteCode } : undefined;
  }

  /** Checkout from a cart. Requires customer/raw auth (or anonymous for guest). */
  async placeOrder(
    input: CheckoutInput,
    auth?: AuthContext,
    opts: CheckoutOptions = {},
  ): Promise<CheckoutResult> {
    const guest = isGuest(input.customer);
    const headers = this.headers(opts, guest);
    return this.ctx.http.request<CheckoutResult>({
      method: "POST",
      path: `/checkout/${this.ctx.tenant}/checkouts/order`,
      auth: resolveAuth(auth, guest),
      query: this.query(opts),
      ...(headers ? { headers } : {}),
      body: input,
    });
  }

  /** Checkout from a quote. */
  async placeOrderFromQuote(
    input: QuoteCheckoutInput,
    auth?: AuthContext,
    opts: CheckoutOptions = {},
  ): Promise<CheckoutResult> {
    const headers = this.headers(opts, false);
    return this.ctx.http.request<CheckoutResult>({
      method: "POST",
      path: `/checkout/${this.ctx.tenant}/checkouts/order`,
      auth: resolveAuth(auth, false),
      query: this.query(opts),
      ...(headers ? { headers } : {}),
      body: input,
    });
  }
}
```

> `RequestOptions.query` accepts `Record<string, string | number | undefined>`
> (Plan 1) — `{ siteCode }` fits. Generated `checkout` types exist for callers
> who want the exact wire schema; the facade exposes idiomatic interfaces and
> treats the vendored spec as source of truth.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/services/checkout.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/checkout.ts packages/sdk/tests/services/checkout.test.ts
git commit -m "feat(checkout): add CheckoutService (cart + quote, saas-token, guest)"
```

---

## Task 4: PaymentGatewayService facade

**Files:**
- Create: `packages/sdk/src/services/payment.ts`
- Test: `packages/sdk/tests/services/payment.test.ts`

Endpoints: `GET /payment-gateway/{tenant}/paymentmodes/frontend` (list modes),
`POST /payment-gateway/{tenant}/payment/frontend/authorize` (post-checkout
deferred authorize). Auth: customer/raw.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { PaymentGatewayService } from "../../src/services/payment";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";
import { EmporixAuthError } from "../../src/core/errors";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
  http.get("https://api.emporix.io/payment-gateway/acme/paymentmodes/frontend", () =>
    HttpResponse.json([{ id: "m1", code: "card", name: "Card" }]),
  ),
  http.post("https://api.emporix.io/payment-gateway/acme/payment/frontend/authorize", () =>
    HttpResponse.json({
      successful: true,
      paymentTransactionId: "t1",
      authorizationToken: "auth1",
      requiresExternalPayment: true,
      externalPaymentRedirectURL: "https://pay.example/redir",
      externalPaymentHttpMethod: "GET",
    }),
  ),
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "payment" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io", provider: tokenProvider, logger,
    retry: { maxAttempts: 1 }, timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new PaymentGatewayService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

describe("PaymentGatewayService", () => {
  it("listPaymentModes returns the configured modes", async () => {
    const modes = await svc().listPaymentModes({ kind: "customer", token: "C" });
    expect(modes[0]?.code).toBe("card");
  });

  it("authorize requires customer/raw and returns the auth result", async () => {
    // @ts-expect-error auth required
    await expect(svc().authorize({ orderId: "EON1", paymentModeId: "m1" })).rejects.toBeInstanceOf(
      EmporixAuthError,
    );
    const r = await svc().authorize(
      { orderId: "EON1", paymentModeId: "m1", creditCardToken: "tok" },
      { kind: "customer", token: "C" },
    );
    expect(r.successful).toBe(true);
    expect(r.externalPaymentRedirectURL).toContain("redir");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/services/payment.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import { EmporixAuthError } from "../core/errors";

/** A frontend payment mode. */
export interface PaymentMode {
  id: string;
  code?: string;
  name?: string;
  [k: string]: unknown;
}

/** Post-checkout authorize request. */
export interface AuthorizePaymentInput {
  orderId: string;
  paymentModeId: string;
  creditCardToken?: string;
}

/** Post-checkout authorize result. */
export interface AuthorizePaymentResult {
  successful: boolean;
  paymentTransactionId?: string;
  authorizationToken?: string;
  requiresExternalPayment?: boolean;
  externalPaymentRedirectURL?: string;
  externalPaymentHttpMethod?: string;
  [k: string]: unknown;
}

function requireCustomer(auth: AuthContext | undefined): AuthContext {
  if (auth && (auth.kind === "customer" || auth.kind === "raw")) return auth;
  throw new EmporixAuthError("payment-gateway requires a customer or raw AuthContext");
}

/** Payment-Gateway: list frontend payment modes, authorize deferred payments. */
export class PaymentGatewayService {
  constructor(private readonly ctx: ClientContext) {}

  /** Lists configured frontend payment modes. */
  async listPaymentModes(auth?: AuthContext): Promise<PaymentMode[]> {
    return this.ctx.http.request<PaymentMode[]>({
      method: "GET",
      path: `/payment-gateway/${this.ctx.tenant}/paymentmodes/frontend`,
      auth: requireCustomer(auth),
    });
  }

  /** Authorizes a post-checkout (deferred) payment for an existing order. */
  async authorize(
    input: AuthorizePaymentInput,
    auth?: AuthContext,
  ): Promise<AuthorizePaymentResult> {
    const body: Record<string, unknown> = {
      order: { id: input.orderId },
      paymentModeId: input.paymentModeId,
    };
    if (input.creditCardToken !== undefined) body.creditCardToken = input.creditCardToken;
    return this.ctx.http.request<AuthorizePaymentResult>({
      method: "POST",
      path: `/payment-gateway/${this.ctx.tenant}/payment/frontend/authorize`,
      auth: requireCustomer(auth),
      body,
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/services/payment.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/payment.ts packages/sdk/tests/services/payment.test.ts
git commit -m "feat(payment): add PaymentGatewayService (modes + deferred authorize)"
```

---

## Task 5: Aggregate into EmporixClient, exports, verification, changeset

**Files:**
- Modify: `packages/sdk/src/client.ts`, `packages/sdk/src/index.ts`, `packages/sdk/src/core/logger.ts` (ServiceName), `packages/sdk/package.json`, `packages/sdk/tsup.config.ts`
- Create: `packages/sdk/src/checkout.ts`, `packages/sdk/src/payment.ts`, `packages/sdk/tests/client-checkout.test.ts`, `.changeset/checkout.md`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { EmporixClient } from "../src/client";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
  http.post("https://api.emporix.io/checkout/acme/checkouts/order", () =>
    HttpResponse.json({ orderId: "EON9", paymentDetails: null, checkoutId: null }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("EmporixClient checkout/payments", () => {
  it("exposes checkout + payments and runs a checkout", async () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.payments).toBeDefined();
    const r = await sdk.checkout.placeOrder(
      {
        cartId: "c1",
        customer: { email: "a@b.co", id: "x" },
        shipping: { methodId: "m", zoneId: "z", methodName: "DHL", amount: 0 },
        addresses: [
          { contactName: "A", street: "S", zipCode: "1", city: "B", country: "DE", type: "SHIPPING" },
          { contactName: "A", street: "S", zipCode: "1", city: "B", country: "DE", type: "BILLING" },
        ],
        paymentMethods: [{ provider: "none" }],
      },
      { kind: "customer", token: "CUST" },
      { saasToken: "SAAS" },
    );
    expect(r.orderId).toBe("EON9");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/client-checkout.test.ts`
Expected: FAIL — `sdk.checkout` undefined.

- [ ] **Step 3: Extend `ServiceName`**

In `packages/sdk/src/core/logger.ts` add `"checkout"` and `"payment"` to the
`ServiceName` union.

- [ ] **Step 4: Wire services into `client.ts`**

Add imports for `CheckoutService` and `PaymentGatewayService`; add
`readonly checkout: CheckoutService;` and `readonly payments: PaymentGatewayService;`
fields; in the constructor: `this.checkout = new CheckoutService(mk("checkout"));`
and `this.payments = new PaymentGatewayService(mk("payment"));`.

- [ ] **Step 5: Public + subpath exports**

In `packages/sdk/src/index.ts` append:

```ts
export { CheckoutService } from "./services/checkout";
export type {
  CheckoutInput, QuoteCheckoutInput, CheckoutResult, CheckoutOptions,
  CheckoutPaymentMethod, CheckoutAddress, CheckoutCustomer,
} from "./services/checkout";
export { PaymentGatewayService } from "./services/payment";
export type {
  PaymentMode, AuthorizePaymentInput, AuthorizePaymentResult,
} from "./services/payment";
```

Create `packages/sdk/src/checkout.ts` → `export * from "./services/checkout";`
and `packages/sdk/src/payment.ts` → `export * from "./services/payment";`.
In `packages/sdk/package.json` `exports` add `./checkout` and `./payment`
(same shape as `./cart`). In `tsup.config.ts` add `"src/checkout.ts"` and
`"src/payment.ts"` to `entry`.

- [ ] **Step 6: Run test + full verification**

Run: `pnpm --filter @viu/emporix-sdk exec vitest run tests/client-checkout.test.ts`
Expected: PASS.
Run: `pnpm --filter @viu/emporix-sdk typecheck && pnpm --filter @viu/emporix-sdk test && pnpm --filter @viu/emporix-sdk build`
Expected: all PASS; coverage ≥ 80% lines/branches (add focused tests if a
threshold fails — do not lower it).

- [ ] **Step 7: Create `.changeset/checkout.md`**

```md
---
"@viu/emporix-sdk": minor
---

Add CheckoutService (cart and quote checkout, `saas-token` header, guest
checkout, `siteCode`) and PaymentGatewayService (frontend payment modes,
post-checkout deferred authorize). HttpClient gains per-request `headers`.
```

- [ ] **Step 8: Commit**

```bash
git add packages/sdk/src packages/sdk/package.json packages/sdk/tsup.config.ts packages/sdk/tests/client-checkout.test.ts .changeset/checkout.md
git commit -m "feat(sdk): expose checkout + payments on EmporixClient with subpath exports"
```

---

## Task 6: React `useCheckout` + `usePaymentModes`

**Files:**
- Create: `packages/react/src/hooks/use-checkout.ts`
- Modify: `packages/react/src/hooks/index.ts`, `packages/react/src/index.ts`
- Test: `packages/react/tests/use-checkout.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useCheckout } from "../src/hooks/use-checkout";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
  http.post("https://api.emporix.io/checkout/acme/checkouts/order", ({ request }) => {
    expect(request.headers.get("saas-token")).toBe("SAAS");
    return HttpResponse.json({ orderId: "EON5", paymentDetails: null, checkoutId: null });
  }),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap(storage = createMemoryStorage({ initial: "cust" })) {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={qc}>
      {children}
    </EmporixProvider>
  );
}

describe("useCheckout", () => {
  it("places an order using the stored customer token + provided saasToken", async () => {
    const { result } = renderHook(() => useCheckout(), { wrapper: wrap() });
    let orderId = "";
    await act(async () => {
      const r = await result.current.placeOrder.mutateAsync({
        input: {
          cartId: "c1",
          customer: { email: "a@b.co", id: "x" },
          shipping: { methodId: "m", zoneId: "z", methodName: "DHL", amount: 0 },
          addresses: [
            { contactName: "A", street: "S", zipCode: "1", city: "B", country: "DE", type: "SHIPPING" },
            { contactName: "A", street: "S", zipCode: "1", city: "B", country: "DE", type: "BILLING" },
          ],
          paymentMethods: [{ provider: "none" }],
        },
        saasToken: "SAAS",
      });
      orderId = r.orderId;
    });
    expect(orderId).toBe("EON5");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @viu/emporix-sdk-react exec vitest run tests/use-checkout.test.tsx`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
import { useMutation, useQuery, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import {
  auth,
  type AuthContext,
  type CheckoutInput,
  type QuoteCheckoutInput,
  type CheckoutResult,
  type PaymentMode,
} from "@viu/emporix-sdk";
import { useEmporix } from "../provider";

function customerCtx(token: string | null): AuthContext {
  if (!token) throw new Error("useCheckout requires a logged-in customer token");
  return auth.customer(token);
}

/** Checkout actions bound to the stored customer session. */
export interface CheckoutApi {
  placeOrder: UseMutationResult<
    CheckoutResult,
    unknown,
    { input: CheckoutInput; saasToken?: string; siteCode?: string }
  >;
  placeOrderFromQuote: UseMutationResult<
    CheckoutResult,
    unknown,
    { input: QuoteCheckoutInput; saasToken?: string; siteCode?: string }
  >;
}

/** React bindings for the checkout flow. */
export function useCheckout(): CheckoutApi {
  const { client, storage } = useEmporix();
  const token = storage.getCustomerToken();
  const placeOrder = useMutation({
    mutationFn: (v: { input: CheckoutInput; saasToken?: string; siteCode?: string }) =>
      client.checkout.placeOrder(v.input, customerCtx(token), {
        ...(v.saasToken !== undefined ? { saasToken: v.saasToken } : {}),
        ...(v.siteCode !== undefined ? { siteCode: v.siteCode } : {}),
      }),
  });
  const placeOrderFromQuote = useMutation({
    mutationFn: (v: { input: QuoteCheckoutInput; saasToken?: string; siteCode?: string }) =>
      client.checkout.placeOrderFromQuote(v.input, customerCtx(token), {
        ...(v.saasToken !== undefined ? { saasToken: v.saasToken } : {}),
        ...(v.siteCode !== undefined ? { siteCode: v.siteCode } : {}),
      }),
  });
  return { placeOrder, placeOrderFromQuote };
}

/** Lists frontend payment modes for the logged-in customer. */
export function usePaymentModes(options: { enabled?: boolean } = {}): UseQueryResult<PaymentMode[]> {
  const { client, storage } = useEmporix();
  const token = storage.getCustomerToken();
  return useQuery({
    queryKey: ["emporix", "payment-modes", { tenant: client.tenant }],
    enabled: (options.enabled ?? true) && token !== null,
    queryFn: () => client.payments.listPaymentModes(customerCtx(token)),
  });
}
```

- [ ] **Step 4: Re-export**

In `packages/react/src/hooks/index.ts` append:

```ts
export { useCheckout, usePaymentModes } from "./use-checkout";
export type { CheckoutApi } from "./use-checkout";
```

In `packages/react/src/index.ts` add `useCheckout`, `usePaymentModes`,
`CheckoutApi` to the existing hook export block.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @viu/emporix-sdk-react exec vitest run tests/use-checkout.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/hooks packages/react/src/index.ts packages/react/tests/use-checkout.test.tsx
git commit -m "feat(react): add useCheckout and usePaymentModes hooks"
```

---

## Task 7: Next example checkout step + docs + final verification + changeset

**Files:**
- Create: `examples/next-app-router/app/checkout/page.tsx`, `docs/checkout.md`
- Modify: `packages/sdk/README.md` (link), `docs/auth.md` (saas-token note)
- Create: `.changeset/checkout-docs.md`

- [ ] **Step 1: Create `examples/next-app-router/app/checkout/page.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useCheckout } from "@viu/emporix-sdk-react";

export default function CheckoutPage(): React.JSX.Element {
  const { placeOrder } = useCheckout();
  const [cartId, setCartId] = useState("");
  const [saasToken, setSaasToken] = useState("");
  const [orderId, setOrderId] = useState<string | null>(null);
  return (
    <main>
      <h1>Checkout</h1>
      <input placeholder="cart id" value={cartId} onChange={(e) => setCartId(e.target.value)} />
      <input
        placeholder="saas token"
        value={saasToken}
        onChange={(e) => setSaasToken(e.target.value)}
      />
      <button
        disabled={!cartId || placeOrder.isPending}
        onClick={async () => {
          const r = await placeOrder.mutateAsync({
            input: {
              cartId,
              customer: { email: "demo@example.com", id: "demo" },
              shipping: { methodId: "m", zoneId: "z", methodName: "DHL", amount: 0 },
              addresses: [
                { contactName: "Demo", street: "S", zipCode: "1", city: "B", country: "DE", type: "SHIPPING" },
                { contactName: "Demo", street: "S", zipCode: "1", city: "B", country: "DE", type: "BILLING" },
              ],
              paymentMethods: [{ provider: "none", method: "invoice" }],
            },
            saasToken,
          });
          setOrderId(r.orderId);
        }}
      >
        Place order
      </button>
      {orderId && <p>Order: {orderId}</p>}
      {placeOrder.isError && <p>Checkout failed.</p>}
    </main>
  );
}
```

- [ ] **Step 2: Write `docs/checkout.md`**

Content: the checkout endpoint and atomic semantics; required body shapes
(cart vs quote); the `saas-token` header (from `customers.login().saasToken`,
required for logged-in, omitted for guest with `customer.guest=true`);
`siteCode`; payment provider variants (`none`/`custom`/`payment-gateway`
in-checkout vs deferred); the post-checkout flow via `payments.authorize` and
handling `paymentDetails.externalPaymentRedirectURL`; 409 handling
(delivery-window capacity / duplicate cart order); React `useCheckout`/
`usePaymentModes` usage; link from `packages/sdk/README.md` and a `saas-token`
note in `docs/auth.md`.

- [ ] **Step 3: Full verification (mirrors CI)**

Run: `pnpm typecheck && pnpm test && pnpm build`
Expected: all PASS repo-wide (incl. examples typecheck); sdk + react suites
green; coverage ≥ 80% per package.
Run: `pnpm changeset status --since=HEAD`
Expected: no config error.

- [ ] **Step 4: Create `.changeset/checkout-docs.md`**

```md
---
"@viu/emporix-sdk": patch
---

Document the checkout & payment flow (docs/checkout.md) and add a Next.js
checkout-step example. No API changes.
```

- [ ] **Step 5: Commit**

```bash
git add examples/next-app-router/app/checkout docs/checkout.md docs/auth.md packages/sdk/README.md .changeset/checkout-docs.md
git commit -m "docs(checkout): add checkout guide and Next checkout example"
```

---

## Self-Review

**Spec coverage:**
- Checkout endpoint (cart + quote, `oneOf`), `saas-token` header, `siteCode`,
  guest vs logged-in, customer/raw auth requirement, `{orderId,paymentDetails,
  checkoutId}` response, 409/4xx mapping → Task 3. ✓
- Payment-Gateway modes + deferred authorize (`order.id`/`paymentModeId`/
  `creditCardToken`) → Task 4. ✓
- Generic per-request headers + `saas-token` redaction (security) → Task 1. ✓
- Vendored + generated checkout/payment specs → Task 2. ✓
- Aggregation, subpath exports (`./checkout`, `./payment`), `ServiceName`
  extension for per-service logging → Task 5. ✓
- React `useCheckout`/`usePaymentModes` → Task 6; Next example + docs → Task 7. ✓

**Placeholder scan:** No TBD/TODO. Doc task (7.2) specifies required content
(documentation deliverable, not code). Generated type names are read during
Task 2 (cannot precede codegen); facades hand-declare idiomatic interfaces and
treat the vendored spec as the wire source of truth, consistent with Plans 2–4.

**Type consistency:** `ClientContext` reused unchanged. `CheckoutResult`
(`orderId`/`paymentDetails`/`checkoutId`) consistent across service, client
test, React hook. `AuthContext`/`auth`/`EmporixAuthError`/`EmporixError` reused
from Plan 1. `RequestOptions.headers` (Task 1) is the exact shape consumed by
`CheckoutService` (Task 3). `useCheckout` consumes `CheckoutInput`/
`QuoteCheckoutInput`/`CheckoutResult` exactly as exported in Task 5. Example +
docs reference only exported public API.

**Carried note:** Changesets `ignore: ["@viu/emporix-examples-*"]` already
re-added in Plan 4; no change needed here.
