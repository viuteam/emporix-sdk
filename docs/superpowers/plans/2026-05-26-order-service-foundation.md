# Order Service Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add customer-facing Order reads + transitions + cancel + reorder to `@viu/emporix-sdk` and `@viu/emporix-sdk-react`, plus a minimal service-account update path on `/salesorders/{id}` for backend mixin/status patches.

**Architecture:** Two flat SDK facades (`client.orders` for customer, `client.salesOrders` for service-token), one shared `generated/order-v2/` types module, seven new React hooks (5 customer + 2 service-account) keyed by tenant/authKind/siteCode/legalEntityId, plus a `prefetchOrder` SSR helper. No new errors, no new storage keys, no new React context.

**Tech Stack:** TypeScript, tsc, ESLint, Vitest + MSW for unit tests, React 18, `@tanstack/react-query` 5, pnpm workspace, changesets.

---

## Spec reference

Implements `docs/superpowers/specs/2026-05-26-order-service-design.md`.

## File structure

### SDK — created

```
packages/sdk/src/generated/order-v2/
  types.gen.ts                       — hand-rolled mirror of order-v2 schemas
  index.ts                           — re-exports types.gen.ts
packages/sdk/src/services/orders.ts  — OrdersService + SalesOrdersService
packages/sdk/src/orders.ts           — façade re-exports
packages/sdk/tests/services/orders.test.ts        — customer service
packages/sdk/tests/services/sales-orders.test.ts  — service-account service
```

### SDK — modified

```
packages/sdk/src/core/logger.ts      — extend ServiceName with 'orders' and 'sales-orders'
packages/sdk/src/client.ts           — instantiate orders + salesOrders services
packages/sdk/src/index.ts            — export * from "./orders"
packages/sdk/package.json            — add "./orders" subpath
packages/sdk/tsup.config.ts          — add "src/orders.ts" entry
packages/sdk/tests/client.test.ts    — assert new services are exposed
```

### React — created

```
packages/react/src/hooks/use-my-orders.ts
packages/react/src/hooks/use-my-orders-infinite.ts
packages/react/src/hooks/use-order.ts
packages/react/src/hooks/use-cancel-order.ts
packages/react/src/hooks/use-order-transition.ts
packages/react/src/hooks/use-reorder.ts
packages/react/src/hooks/use-sales-order.ts
packages/react/src/hooks/use-update-sales-order.ts
packages/react/tests/use-my-orders.test.tsx
packages/react/tests/use-my-orders-infinite.test.tsx
packages/react/tests/use-order.test.tsx
packages/react/tests/use-cancel-order.test.tsx
packages/react/tests/use-order-transition.test.tsx
packages/react/tests/use-reorder.test.tsx
packages/react/tests/use-sales-order.test.tsx
packages/react/tests/use-update-sales-order.test.tsx
packages/react/tests/use-my-orders-b2b.test.tsx
```

### React — modified

```
packages/react/src/ssr.ts            — add prefetchOrder helper
packages/react/src/hooks/index.ts    — export new hooks
packages/react/src/index.ts          — re-export new hooks + prefetchOrder
packages/react/tests/ssr.test.ts     — prefetchOrder hydration test (or new file if missing)
```

### Examples — created/modified

```
examples/vite-spa/src/pages/OrderHistory.tsx
examples/vite-spa/src/pages/OrderDetail.tsx
examples/vite-spa/src/App.tsx        — add /account/orders + /:id routes + nav link
```

### Docs — created/modified

```
docs/orders.md                       — new
docs/auth.md                         — append saas-token + orders pointer
docs/react.md                        — extend hook listings
CLAUDE.md                            — add Orders + SalesOrders to service list
README.md                            — service tally
```

### Changesets — created

```
.changeset/order-service-foundation-sdk.md
.changeset/order-service-foundation-react.md
```

---

## Conventions

- Commit subject: `<type>(<scope>): <lowercase-verb> …`. Scopes here: `sdk`, `react`, `docs`, `examples`, `repo`, `release`. First word after the scope MUST be a lowercase verb — sentence-case is rejected by commitlint (`commitlint.config.js`).
- Branch: `feat/order-service-foundation` (already created; the spec commit `929eb1b` already lives on it).
- All commits end with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- Test customer token in fixtures: `"cust"`. Tenant: `"acme"`. (Matches existing `tests/use-my-segments.test.tsx`.)
- Husky pre-commit runs `pnpm lint` + `pnpm typecheck`; tests are your responsibility before commit.
- Examples typecheck against built dist — run `pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react build` whenever SDK/React source changes before example-typecheck.

---

## Task 1: Vendor `order-v2` types + extend `ServiceName`

**Files:**
- Create: `packages/sdk/src/generated/order-v2/types.gen.ts`
- Create: `packages/sdk/src/generated/order-v2/index.ts`
- Modify: `packages/sdk/src/core/logger.ts`

- [ ] **Step 1: Create order-v2 types**

`packages/sdk/src/generated/order-v2/types.gen.ts`:

```ts
/**
 * Hand-written mirror of the Emporix Order-v2 schemas (storefront-relevant
 * subset). Captures /orders, /orders/{id}, /orders/{id}/transitions, and
 * /salesorders/{id} response/body shapes.
 *
 * **Not generated.** When the OpenAPI input file lands in the repo, this
 * file is replaced by codegen output. Keep the exported names stable so
 * the façade re-exports don't churn.
 */

export type OrderStatus =
  | "CREATED"
  | "IN_CHECKOUT"
  | "CONFIRMED"
  | "SHIPPED"
  | "COMPLETED"
  | "DECLINED";

export interface OrderMoney {
  amount: number;
  currency: string;
}

export interface OrderItem {
  id: string;
  productId: string;
  productCode?: string;
  productName?: string | Record<string, string>;
  imageUrl?: string;
  quantity: number;
  unitPrice: OrderMoney;
  totalPrice: OrderMoney;
}

export interface OrderCustomer {
  id?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  guest?: boolean;
}

export interface OrderAddress {
  contactName?: string;
  companyName?: string;
  street?: string;
  streetNumber?: string;
  zip?: string;
  city?: string;
  country?: string;
}

export interface OrderPayment {
  paymentMode?: string;
  paymentStatus?: string;
  transactionId?: string;
}

export interface OrderDelivery {
  deliveryDate?: string;
  trackingNumber?: string;
  carrier?: string;
}

export interface OrderTaxLine {
  rate: number;
  amount: number;
}

export interface OrderMetadata {
  version: number;
  createdAt: string;
  modifiedAt: string;
  mixins?: Record<string, unknown>;
}

export interface Order {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  currency: string;
  totalPrice: OrderMoney;
  subTotalPrice?: OrderMoney;
  shippingPrice?: OrderMoney;
  taxAggregate?: { lines: OrderTaxLine[] };
  items: OrderItem[];
  customer?: OrderCustomer;
  billingAddress?: OrderAddress;
  shippingAddress?: OrderAddress;
  payment?: OrderPayment;
  delivery?: OrderDelivery;
  siteCode?: string;
  legalEntityId?: string;
  channel?: string;
  metadata?: OrderMetadata;
  mixins?: Record<string, unknown>;
  customAttributes?: Record<string, unknown>;
}

export interface OrderTransition {
  status: OrderStatus;
  comment?: string;
}

export interface SalesOrderPatch {
  status?: OrderStatus;
  mixins?: Record<string, unknown>;
  customAttributes?: Record<string, unknown>;
  metadata?: { version: number; mixins?: Record<string, unknown> };
}
```

- [ ] **Step 2: Create order-v2 index**

`packages/sdk/src/generated/order-v2/index.ts`:

```ts
export * from "./types.gen";
```

- [ ] **Step 3: Extend `ServiceName`**

In `packages/sdk/src/core/logger.ts`, find the existing `ServiceName` union (ends with `"iam" | "http" | "auth"` after the B2B Foundation merge) and add two new entries:

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
  | "http"
  | "auth";
```

- [ ] **Step 4: Typecheck**

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: PASS — types file compiles, ServiceName extension is type-only.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/generated/order-v2 packages/sdk/src/core/logger.ts
git commit -m "feat(sdk): vendor order-v2 type schemas and extend ServiceName

Hand-rolled storefront-relevant Order-v2 shapes (Order, OrderItem,
OrderStatus, OrderTransition, SalesOrderPatch). Adds 'orders' and
'sales-orders' to the ServiceName union for per-service logger
scoping. Pending real OpenAPI codegen.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `OrdersService` (customer) + tests

**Files:**
- Create: `packages/sdk/src/services/orders.ts` (will hold both services; only `OrdersService` written here)
- Create: `packages/sdk/tests/services/orders.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/sdk/tests/services/orders.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { OrdersService } from "../../src/services/orders";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";
import {
  EmporixNotFoundError,
  EmporixValidationError,
} from "../../src/core/errors";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function svc(): OrdersService {
  const cfg = {
    tenant: "acme",
    host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "orders" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new OrdersService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const CUST = { kind: "customer" as const, token: "cust-tok" };

describe("OrdersService.listMine", () => {
  it("GETs /orders with the customer Bearer", async () => {
    let auth: string | null = null;
    server.use(
      http.get("https://api.emporix.io/order-v2/acme/orders", ({ request }) => {
        auth = request.headers.get("authorization");
        return HttpResponse.json({
          items: [{ id: "o-1", orderNumber: "ORD-1", status: "CREATED", currency: "CHF", totalPrice: { amount: 10, currency: "CHF" }, items: [] }],
          pageNumber: 1,
          pageSize: 10,
          hasNextPage: false,
        });
      }),
    );
    const r = await svc().listMine(CUST);
    expect(auth).toBe("Bearer cust-tok");
    expect(r.items[0]?.id).toBe("o-1");
    expect(r.hasNextPage).toBe(false);
  });

  it("forwards pagination + filter params and saas-token header", async () => {
    let q: URLSearchParams | null = null;
    let saas: string | null = null;
    server.use(
      http.get("https://api.emporix.io/order-v2/acme/orders", ({ request }) => {
        q = new URL(request.url).searchParams;
        saas = request.headers.get("saas-token");
        return HttpResponse.json({ items: [], pageNumber: 2, pageSize: 5, hasNextPage: false });
      }),
    );
    await svc().listMine(CUST, {
      pageNumber: 2,
      pageSize: 5,
      status: "SHIPPED",
      legalEntityId: "le-1",
      siteCode: "main",
      saasToken: "saas-xyz",
    });
    expect((q as URLSearchParams | null)?.get("pageNumber")).toBe("2");
    expect((q as URLSearchParams | null)?.get("pageSize")).toBe("5");
    expect((q as URLSearchParams | null)?.get("status")).toBe("SHIPPED");
    expect((q as URLSearchParams | null)?.get("legalEntityId")).toBe("le-1");
    expect((q as URLSearchParams | null)?.get("siteCode")).toBe("main");
    expect(saas).toBe("saas-xyz");
  });
});

describe("OrdersService.get", () => {
  it("GETs /orders/{id} and returns the order", async () => {
    server.use(
      http.get("https://api.emporix.io/order-v2/acme/orders/o-1", () =>
        HttpResponse.json({ id: "o-1", orderNumber: "ORD-1", status: "CREATED", currency: "CHF", totalPrice: { amount: 10, currency: "CHF" }, items: [] }),
      ),
    );
    const r = await svc().get("o-1", CUST);
    expect(r.orderNumber).toBe("ORD-1");
  });

  it("maps 404 to EmporixNotFoundError", async () => {
    server.use(
      http.get("https://api.emporix.io/order-v2/acme/orders/missing", () =>
        new HttpResponse(null, { status: 404 }),
      ),
    );
    await expect(svc().get("missing", CUST)).rejects.toBeInstanceOf(EmporixNotFoundError);
  });
});

describe("OrdersService.transition", () => {
  it("POSTs /transitions with the status body", async () => {
    let body: unknown = null;
    server.use(
      http.post("https://api.emporix.io/order-v2/acme/orders/o-1/transitions", async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await svc().transition("o-1", "DECLINED", CUST);
    expect(body).toEqual({ status: "DECLINED" });
  });

  it("includes comment when provided", async () => {
    let body: unknown = null;
    server.use(
      http.post("https://api.emporix.io/order-v2/acme/orders/o-1/transitions", async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await svc().transition("o-1", "DECLINED", CUST, { comment: "wrong size" });
    expect(body).toEqual({ status: "DECLINED", comment: "wrong size" });
  });

  it("maps 400 to EmporixValidationError (illegal transition)", async () => {
    server.use(
      http.post("https://api.emporix.io/order-v2/acme/orders/o-1/transitions", () =>
        HttpResponse.json({ message: "illegal transition" }, { status: 400 }),
      ),
    );
    await expect(svc().transition("o-1", "COMPLETED", CUST)).rejects.toBeInstanceOf(
      EmporixValidationError,
    );
  });
});

describe("OrdersService.cancel", () => {
  it("delegates to transition with DECLINED", async () => {
    let body: unknown = null;
    server.use(
      http.post("https://api.emporix.io/order-v2/acme/orders/o-1/transitions", async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await svc().cancel("o-1", CUST);
    expect(body).toEqual({ status: "DECLINED" });
  });

  it("forwards saas-token to the underlying transition call", async () => {
    let saas: string | null = null;
    server.use(
      http.post("https://api.emporix.io/order-v2/acme/orders/o-1/transitions", ({ request }) => {
        saas = request.headers.get("saas-token");
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await svc().cancel("o-1", CUST, { saasToken: "saas-xyz" });
    expect(saas).toBe("saas-xyz");
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `cd packages/sdk && pnpm exec vitest run tests/services/orders.test.ts`
Expected: FAIL — `Cannot find module '../../src/services/orders'`.

- [ ] **Step 3: Implement `OrdersService`**

Create `packages/sdk/src/services/orders.ts` with **only the customer service** (SalesOrdersService comes in Task 3, appended to this file):

```ts
import type { ClientContext, PaginatedItems } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  Order,
  OrderStatus,
} from "../generated/order-v2";

/** Optional fields supported by the order-v2 list endpoint. */
export interface ListMyOrdersOptions {
  pageNumber?: number;
  pageSize?: number;
  status?: OrderStatus;
  legalEntityId?: string;
  siteCode?: string;
  saasToken?: string;
}

/** Options for single-order reads (saas-token only). */
export interface GetOrderOptions {
  saasToken?: string;
}

/** Options for status transitions. */
export interface OrderTransitionOptions {
  saasToken?: string;
  comment?: string;
}

function setIfDefined<V>(
  q: Record<string, string | number | undefined>,
  key: string,
  value: V | undefined,
): void {
  if (value !== undefined && value !== "") {
    q[key] = value as unknown as string | number;
  }
}

/**
 * Storefront-customer access to Order-v2's customer endpoints.
 *
 * `listMine`/`get` require `order.order_read_own`; transitions require
 * `order.order_manage_own`. All methods accept an optional `saasToken` that
 * is passed as the `saas-token` header (mirrors `checkout.placeOrder`).
 */
export class OrdersService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/order-v2/${this.ctx.tenant}/orders`;
  }

  private saasHeader(saasToken: string | undefined): Record<string, string> | undefined {
    return saasToken ? { "saas-token": saasToken } : undefined;
  }

  /** Lists the calling customer's orders. */
  async listMine(
    auth: AuthContext,
    opts: ListMyOrdersOptions = {},
  ): Promise<PaginatedItems<Order>> {
    const query: Record<string, string | number | undefined> = {};
    setIfDefined(query, "pageNumber", opts.pageNumber);
    setIfDefined(query, "pageSize", opts.pageSize);
    setIfDefined(query, "status", opts.status);
    setIfDefined(query, "legalEntityId", opts.legalEntityId);
    setIfDefined(query, "siteCode", opts.siteCode);
    const headers = this.saasHeader(opts.saasToken);
    return this.ctx.http.request<PaginatedItems<Order>>({
      method: "GET",
      path: this.base(),
      query,
      auth,
      ...(headers ? { headers } : {}),
    });
  }

  /** Fetches one of the calling customer's orders by id. */
  async get(
    orderId: string,
    auth: AuthContext,
    opts: GetOrderOptions = {},
  ): Promise<Order> {
    const headers = this.saasHeader(opts.saasToken);
    return this.ctx.http.request<Order>({
      method: "GET",
      path: `${this.base()}/${orderId}`,
      auth,
      ...(headers ? { headers } : {}),
    });
  }

  /** Transitions an order to a new status. Server enforces legal transitions. */
  async transition(
    orderId: string,
    status: OrderStatus,
    auth: AuthContext,
    opts: OrderTransitionOptions = {},
  ): Promise<void> {
    const body: { status: OrderStatus; comment?: string } = { status };
    if (opts.comment !== undefined) body.comment = opts.comment;
    const headers = this.saasHeader(opts.saasToken);
    await this.ctx.http.request<void>({
      method: "POST",
      path: `${this.base()}/${orderId}/transitions`,
      auth,
      body,
      ...(headers ? { headers } : {}),
    });
  }

  /** Convenience: transitions to `DECLINED` (customer cancel). */
  async cancel(
    orderId: string,
    auth: AuthContext,
    opts: { saasToken?: string } = {},
  ): Promise<void> {
    await this.transition(orderId, "DECLINED", auth, opts);
  }
}
```

- [ ] **Step 4: Run, expect pass**

Run: `cd packages/sdk && pnpm exec vitest run tests/services/orders.test.ts`
Expected: PASS — 7 tests across the four describes.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/orders.ts packages/sdk/tests/services/orders.test.ts
git commit -m "feat(sdk): add OrdersService for customer-facing order reads + transitions

listMine/get/transition with saas-token opt-in; cancel as a helper
that delegates to transition(DECLINED). 7 MSW unit tests cover
pagination params, saas-token header, 404 → NotFoundError, and 400
→ ValidationError on illegal transitions.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `SalesOrdersService` (service-token) + tests

**Files:**
- Modify: `packages/sdk/src/services/orders.ts` (append SalesOrdersService)
- Create: `packages/sdk/tests/services/sales-orders.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/sdk/tests/services/sales-orders.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { SalesOrdersService } from "../../src/services/orders";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";
import {
  EmporixForbiddenError,
  EmporixInsufficientScopeError,
} from "../../src/core/errors";

const server = setupServer(
  http.post("https://api.emporix.io/oauth/token", () =>
    HttpResponse.json({ access_token: "svc-tok", expires_in: 3600 }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function svc(): SalesOrdersService {
  const cfg = {
    tenant: "acme",
    host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "sales-orders" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new SalesOrdersService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const SERVICE = { kind: "service" as const, credentials: "backend" };

describe("SalesOrdersService.get", () => {
  it("GETs /salesorders/{id} with the service Bearer", async () => {
    let auth: string | null = null;
    server.use(
      http.get("https://api.emporix.io/order-v2/acme/salesorders/o-1", ({ request }) => {
        auth = request.headers.get("authorization");
        return HttpResponse.json({
          id: "o-1", orderNumber: "ORD-1", status: "CONFIRMED",
          currency: "CHF", totalPrice: { amount: 99, currency: "CHF" }, items: [],
        });
      }),
    );
    const r = await svc().get("o-1", SERVICE);
    expect(auth).toBe("Bearer svc-tok");
    expect(r.status).toBe("CONFIRMED");
  });
});

describe("SalesOrdersService.update", () => {
  it("PATCHes /salesorders/{id} with the body and returns the patched order", async () => {
    let body: unknown = null;
    server.use(
      http.patch("https://api.emporix.io/order-v2/acme/salesorders/o-1", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          id: "o-1", orderNumber: "ORD-1", status: "SHIPPED",
          currency: "CHF", totalPrice: { amount: 99, currency: "CHF" }, items: [],
          mixins: { fulfilment: { trackingNumber: "T123" } },
        });
      }),
    );
    const r = await svc().update(
      "o-1",
      { status: "SHIPPED", mixins: { fulfilment: { trackingNumber: "T123" } } },
      SERVICE,
    );
    expect(body).toEqual({
      status: "SHIPPED",
      mixins: { fulfilment: { trackingNumber: "T123" } },
    });
    expect(r.status).toBe("SHIPPED");
  });

  it("sends ?recalculate=false when opts.recalculate === false", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.patch("https://api.emporix.io/order-v2/acme/salesorders/o-1", ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json({
          id: "o-1", orderNumber: "ORD-1", status: "CONFIRMED",
          currency: "CHF", totalPrice: { amount: 99, currency: "CHF" }, items: [],
        });
      }),
    );
    await svc().update("o-1", { status: "CONFIRMED" }, SERVICE, { recalculate: false });
    expect((q as URLSearchParams | null)?.get("recalculate")).toBe("false");
  });

  it("does not send ?recalculate when opts.recalculate is undefined (server default)", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.patch("https://api.emporix.io/order-v2/acme/salesorders/o-1", ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json({
          id: "o-1", orderNumber: "ORD-1", status: "CONFIRMED",
          currency: "CHF", totalPrice: { amount: 99, currency: "CHF" }, items: [],
        });
      }),
    );
    await svc().update("o-1", { status: "CONFIRMED" }, SERVICE);
    expect((q as URLSearchParams | null)?.has("recalculate")).toBe(false);
  });

  it("maps 403 with scope hint to EmporixInsufficientScopeError", async () => {
    server.use(
      http.patch("https://api.emporix.io/order-v2/acme/salesorders/o-1", () =>
        HttpResponse.json(
          { code: 403, status: "Forbidden", details: ["missing scope: order.order_manage"] },
          { status: 403 },
        ),
      ),
    );
    await expect(
      svc().update("o-1", { status: "CONFIRMED" }, SERVICE),
    ).rejects.toBeInstanceOf(EmporixInsufficientScopeError);
  });

  it("maps 403 without scope hint to EmporixForbiddenError", async () => {
    server.use(
      http.patch("https://api.emporix.io/order-v2/acme/salesorders/o-1", () =>
        HttpResponse.json({ code: 403 }, { status: 403 }),
      ),
    );
    await expect(
      svc().update("o-1", { status: "CONFIRMED" }, SERVICE),
    ).rejects.toBeInstanceOf(EmporixForbiddenError);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `cd packages/sdk && pnpm exec vitest run tests/services/sales-orders.test.ts`
Expected: FAIL — `SalesOrdersService is not exported`.

- [ ] **Step 3: Append `SalesOrdersService` to `packages/sdk/src/services/orders.ts`**

Add to the existing file (below `OrdersService`):

```ts
import type { SalesOrderPatch } from "../generated/order-v2";

/** Options for `salesOrders.update`. */
export interface UpdateSalesOrderOptions {
  /** Forwarded as `?recalculate=`. Omit to use the server default (true). */
  recalculate?: boolean;
}

/**
 * Backend / service-account access to the merchant-facing
 * `/salesorders/{id}` resource. Requires `order.order_read` (read) /
 * `order.order_manage` (update) scopes on a service token.
 *
 * The full admin list + filter surface is deferred to a follow-up
 * sub-spec. This service ships only single-resource read + patch — the
 * common backend use case (e.g. mixin updates after fulfilment).
 */
export class SalesOrdersService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/order-v2/${this.ctx.tenant}/salesorders`;
  }

  /** Fetches a single sales-order by id. */
  async get(orderId: string, auth: AuthContext): Promise<Order> {
    return this.ctx.http.request<Order>({
      method: "GET",
      path: `${this.base()}/${orderId}`,
      auth,
    });
  }

  /** Patches an existing order (status, mixins, customAttributes, metadata). */
  async update(
    orderId: string,
    patch: SalesOrderPatch,
    auth: AuthContext,
    opts: UpdateSalesOrderOptions = {},
  ): Promise<Order> {
    const query: Record<string, string> = {};
    if (opts.recalculate === false) query.recalculate = "false";
    return this.ctx.http.request<Order>({
      method: "PATCH",
      path: `${this.base()}/${orderId}`,
      auth,
      ...(Object.keys(query).length > 0 ? { query } : {}),
      body: patch,
    });
  }
}
```

- [ ] **Step 4: Run, expect pass**

Run: `cd packages/sdk && pnpm exec vitest run tests/services/sales-orders.test.ts`
Expected: PASS — 5 tests across the two describes.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/orders.ts packages/sdk/tests/services/sales-orders.test.ts
git commit -m "feat(sdk): add SalesOrdersService for service-account order patches

get + update on /salesorders/{id} with optional ?recalculate=false.
update accepts SalesOrderPatch (status, mixins, customAttributes,
metadata). 5 MSW unit tests cover Bearer-flow, body roundtrip,
recalculate flag, and 403-with-scope-hint mapping.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Wire `client.orders` + `client.salesOrders` into `EmporixClient`; façade + subpath

**Files:**
- Create: `packages/sdk/src/orders.ts`
- Modify: `packages/sdk/src/client.ts`
- Modify: `packages/sdk/src/index.ts`
- Modify: `packages/sdk/package.json`
- Modify: `packages/sdk/tsup.config.ts`
- Modify: `packages/sdk/tests/client.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/sdk/tests/client.test.ts`, append (or extend if a similar block exists):

```ts
describe("EmporixClient order services", () => {
  it("exposes orders + salesOrders", () => {
    const c = new EmporixClient({
      tenant: "acme",
      credentials: { storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(c.orders).toBeDefined();
    expect(c.salesOrders).toBeDefined();
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `cd packages/sdk && pnpm exec vitest run tests/client.test.ts`
Expected: FAIL — `c.orders` is undefined.

- [ ] **Step 3: Create the façade re-export**

`packages/sdk/src/orders.ts`:

```ts
export {
  OrdersService,
  SalesOrdersService,
  type ListMyOrdersOptions,
  type GetOrderOptions,
  type OrderTransitionOptions,
  type UpdateSalesOrderOptions,
} from "./services/orders";
export type {
  Order,
  OrderItem,
  OrderStatus,
  OrderMoney,
  OrderCustomer,
  OrderAddress,
  OrderPayment,
  OrderDelivery,
  OrderTaxLine,
  OrderMetadata,
  OrderTransition,
  SalesOrderPatch,
} from "./generated/order-v2";
```

- [ ] **Step 4: Wire into `EmporixClient`**

In `packages/sdk/src/client.ts`, add the imports next to the other service imports:

```ts
import { OrdersService, SalesOrdersService } from "./services/orders";
```

Add the readonly fields next to the existing readonly declarations:

```ts
  readonly orders: OrdersService;
  readonly salesOrders: SalesOrdersService;
```

Inside the constructor, after the existing service instantiations (e.g. after `this.customerGroups = …`), add:

```ts
    this.orders = new OrdersService(mk("orders"));
    this.salesOrders = new SalesOrdersService(mk("sales-orders"));
```

- [ ] **Step 5: Export from package root**

In `packages/sdk/src/index.ts`, add to the existing re-exports list:

```ts
export * from "./orders";
```

- [ ] **Step 6: Subpath export**

In `packages/sdk/package.json`, add an entry to the `exports` map (next to the existing `./companies`, `./contacts`, etc., **or** alongside `./segment` if the B2B subpath exports haven't merged yet — adapt to the current file state):

```json
    "./orders": { "types": "./dist/orders.d.ts", "import": "./dist/orders.js", "require": "./dist/orders.cjs" }
```

- [ ] **Step 7: Tsup entry**

In `packages/sdk/tsup.config.ts`, add `"src/orders.ts"` to the `entry` array.

- [ ] **Step 8: Run, expect pass**

```
cd packages/sdk && pnpm exec vitest run tests/client.test.ts
pnpm -F @viu/emporix-sdk build
ls packages/sdk/dist/orders.* | wc -l
```
Expected: client test PASS; dist contains `orders.js`, `orders.cjs`, `orders.d.ts`, `orders.d.cts` (≥4 files).

- [ ] **Step 9: Run all SDK tests**

Run: `pnpm -F @viu/emporix-sdk test`
Expected: PASS — all existing suites + new client/orders/sales-orders tests.

- [ ] **Step 10: Commit**

```bash
git add packages/sdk/src/orders.ts packages/sdk/src/client.ts packages/sdk/src/index.ts packages/sdk/package.json packages/sdk/tsup.config.ts packages/sdk/tests/client.test.ts
git commit -m "feat(sdk): wire orders + salesOrders services into EmporixClient

Adds client.orders + client.salesOrders, the ./orders subpath
export, tsup entry, and the matching client.test assertion. Both
services share the order-v2 generated types module.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `prefetchOrder` SSR helper

**Files:**
- Modify: `packages/react/src/ssr.ts`
- Modify: `packages/react/tests/ssr.test.ts` (create if absent)

- [ ] **Step 1: Check if `tests/ssr.test.ts` exists**

Run: `ls packages/react/tests/ssr.test.ts 2>/dev/null && echo EXISTS || echo NEW`

- [ ] **Step 2: Write the failing test**

If the file exists, append the new describe block. If not, create with the full file:

`packages/react/tests/ssr.test.ts` (full file shown; if it exists, append from `describe("prefetchOrder")` only):

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { auth, EmporixClient } from "@viu/emporix-sdk";
import { prefetchOrder } from "../src/ssr";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("prefetchOrder", () => {
  it("prefetches the same cache key useOrder would read", async () => {
    server.use(
      http.get("https://api.emporix.io/order-v2/acme/orders/o-1", () =>
        HttpResponse.json({
          id: "o-1", orderNumber: "ORD-1", status: "CREATED",
          currency: "CHF", totalPrice: { amount: 10, currency: "CHF" }, items: [],
        }),
      ),
    );
    const client = new EmporixClient({
      tenant: "acme",
      credentials: { storefront: { clientId: "sf" } },
      logger: false,
    });
    const qc = new QueryClient();
    await prefetchOrder(qc, client, "o-1", auth.customer("cust"));
    const cached = qc.getQueryData([
      "emporix",
      "orders",
      "o-1",
      { tenant: "acme", authKind: "customer" },
    ]);
    expect((cached as { orderNumber?: string } | undefined)?.orderNumber).toBe("ORD-1");
  });

  it("forwards opts.saasToken as the saas-token header", async () => {
    let saas: string | null = null;
    server.use(
      http.get("https://api.emporix.io/order-v2/acme/orders/o-2", ({ request }) => {
        saas = request.headers.get("saas-token");
        return HttpResponse.json({
          id: "o-2", orderNumber: "ORD-2", status: "CREATED",
          currency: "CHF", totalPrice: { amount: 10, currency: "CHF" }, items: [],
        });
      }),
    );
    const client = new EmporixClient({
      tenant: "acme",
      credentials: { storefront: { clientId: "sf" } },
      logger: false,
    });
    await prefetchOrder(new QueryClient(), client, "o-2", auth.customer("cust"), {
      saasToken: "saas-xyz",
    });
    expect(saas).toBe("saas-xyz");
  });
});
```

- [ ] **Step 3: Run, expect failure**

Run: `cd packages/react && pnpm exec vitest run tests/ssr.test.ts`
Expected: FAIL — `prefetchOrder is not exported from ../src/ssr`.

- [ ] **Step 4: Implement `prefetchOrder`**

Append to `packages/react/src/ssr.ts`:

```ts
/**
 * Server-side prefetch of a single customer order. Writes the same cache key
 * `useOrder(orderId)` reads, so client hydration is a cache hit.
 */
export async function prefetchOrder(
  qc: QueryClient,
  client: EmporixClient,
  orderId: string,
  authCtx: AuthContext,
  opts: { saasToken?: string } = {},
): Promise<void> {
  await qc.prefetchQuery({
    queryKey: ["emporix", "orders", orderId, { tenant: client.tenant, authKind: authCtx.kind }],
    queryFn: () => client.orders.get(orderId, authCtx, opts.saasToken ? { saasToken: opts.saasToken } : {}),
  });
}
```

- [ ] **Step 5: Re-export from package root**

In `packages/react/src/index.ts`, find `export { prefetchProduct, prefetchCart } from "./ssr";` and extend:

```ts
export { prefetchProduct, prefetchCart, prefetchOrder } from "./ssr";
```

- [ ] **Step 6: Build SDK, then run tests**

The React package imports from `@viu/emporix-sdk`; tests use built dist:

```
pnpm -F @viu/emporix-sdk build
cd packages/react && pnpm exec vitest run tests/ssr.test.ts
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/ssr.ts packages/react/src/index.ts packages/react/tests/ssr.test.ts
git commit -m "feat(react): add prefetchOrder SSR helper

Writes the cache key useOrder(orderId) reads, with optional
saas-token opt-in. Mirrors prefetchProduct / prefetchCart.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `useMyOrders` + `useMyOrdersInfinite` hooks

**Files:**
- Create: `packages/react/src/hooks/use-my-orders.ts`
- Create: `packages/react/src/hooks/use-my-orders-infinite.ts`
- Create: `packages/react/tests/use-my-orders.test.tsx`
- Create: `packages/react/tests/use-my-orders-infinite.test.tsx`
- Modify: `packages/react/src/hooks/index.ts`
- Modify: `packages/react/src/index.ts`

- [ ] **Step 1: Write the failing `use-my-orders` test**

`packages/react/tests/use-my-orders.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useMyOrders } from "../src/hooks/use-my-orders";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "anon-rt", sessionId: "s",
    }),
  ),
  // Default — CompanyContextProvider auto-fetches listMine on mount.
  http.get("https://api.emporix.io/customer-management/acme/legal-entities", () =>
    HttpResponse.json([]),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap(storage = createMemoryStorage()) {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
}

describe("useMyOrders", () => {
  it("is disabled without a customer token", () => {
    const { result } = renderHook(() => useMyOrders(), { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("fetches the customer's orders", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    server.use(
      http.get("https://api.emporix.io/order-v2/acme/orders", () =>
        HttpResponse.json({
          items: [{ id: "o-1", orderNumber: "ORD-1", status: "CREATED", currency: "CHF", totalPrice: { amount: 10, currency: "CHF" }, items: [] }],
          pageNumber: 1, pageSize: 10, hasNextPage: false,
        }),
      ),
    );
    const { result } = renderHook(() => useMyOrders(), { wrapper: wrap(storage) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items[0]?.id).toBe("o-1");
  });

  it("forwards pagination, status, saasToken and explicit legalEntityId", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    let q: URLSearchParams | null = null;
    let saas: string | null = null;
    server.use(
      http.get("https://api.emporix.io/order-v2/acme/orders", ({ request }) => {
        q = new URL(request.url).searchParams;
        saas = request.headers.get("saas-token");
        return HttpResponse.json({ items: [], pageNumber: 2, pageSize: 5, hasNextPage: false });
      }),
    );
    const { result } = renderHook(
      () => useMyOrders({ pageNumber: 2, pageSize: 5, status: "SHIPPED", legalEntityId: "le-1", saasToken: "saas-xyz" }),
      { wrapper: wrap(storage) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect((q as URLSearchParams | null)?.get("pageNumber")).toBe("2");
    expect((q as URLSearchParams | null)?.get("status")).toBe("SHIPPED");
    expect((q as URLSearchParams | null)?.get("legalEntityId")).toBe("le-1");
    expect(saas).toBe("saas-xyz");
  });

  it("defaults legalEntityId from the active company", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    storage.setRefreshToken("r");
    let leSeen: string | null = null;
    server.use(
      http.get("https://api.emporix.io/customer-management/acme/legal-entities", () =>
        HttpResponse.json([{ id: "le-1", name: "Acme", type: "COMPANY" }]),
      ),
      http.get("https://api.emporix.io/customer/acme/refreshauthtoken", () =>
        HttpResponse.json({ access_token: "scoped", refresh_token: "r2" }),
      ),
      http.get("https://api.emporix.io/order-v2/acme/orders", ({ request }) => {
        leSeen = new URL(request.url).searchParams.get("legalEntityId");
        return HttpResponse.json({ items: [], pageNumber: 1, pageSize: 10, hasNextPage: false });
      }),
    );
    const { result } = renderHook(() => useMyOrders(), { wrapper: wrap(storage) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(leSeen).toBe("le-1");
  });

  it("explicit legalEntityId: null disables the auto-default", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    storage.setRefreshToken("r");
    let leSeen: string | null = "unset";
    server.use(
      http.get("https://api.emporix.io/customer-management/acme/legal-entities", () =>
        HttpResponse.json([{ id: "le-1", name: "Acme", type: "COMPANY" }]),
      ),
      http.get("https://api.emporix.io/customer/acme/refreshauthtoken", () =>
        HttpResponse.json({ access_token: "scoped", refresh_token: "r2" }),
      ),
      http.get("https://api.emporix.io/order-v2/acme/orders", ({ request }) => {
        leSeen = new URL(request.url).searchParams.get("legalEntityId");
        return HttpResponse.json({ items: [], pageNumber: 1, pageSize: 10, hasNextPage: false });
      }),
    );
    const { result } = renderHook(() => useMyOrders({ legalEntityId: null }), { wrapper: wrap(storage) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(leSeen).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `cd packages/react && pnpm exec vitest run tests/use-my-orders.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `useMyOrders`**

`packages/react/src/hooks/use-my-orders.ts`:

```ts
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { auth, type Order, type OrderStatus, type PaginatedItems } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useActiveCompany } from "../company-context";
import { emporixKey } from "./internal/query-keys";
import { useReadSite } from "./internal/use-read-site";

/** Options for `useMyOrders`. Passing `legalEntityId: null` disables the active-company auto-default. */
export interface UseMyOrdersOptions {
  pageNumber?: number;
  pageSize?: number;
  status?: OrderStatus;
  /** `undefined` = default from `useActiveCompany`. `null` = no filter. */
  legalEntityId?: string | null;
  saasToken?: string;
}

/** Paginated read of the customer's own orders. Disabled without a customer token. */
export function useMyOrders(
  options: UseMyOrdersOptions = {},
): UseQueryResult<PaginatedItems<Order>> {
  const { client, storage } = useEmporix();
  const { activeCompany } = useActiveCompany();
  const { siteCode } = useReadSite();
  const token = storage.getCustomerToken();
  const effectiveLE: string | undefined =
    options.legalEntityId === null
      ? undefined
      : options.legalEntityId ?? activeCompany?.id;
  return useQuery({
    queryKey: emporixKey(
      "orders",
      ["mine", effectiveLE ?? null, options.status ?? null, options.pageNumber ?? 1, options.pageSize ?? null],
      { tenant: client.tenant, authKind: token ? "customer" : "anonymous", siteCode },
    ),
    enabled: token !== null,
    queryFn: () =>
      client.orders.listMine(auth.customer(token as string), {
        ...(options.pageNumber !== undefined ? { pageNumber: options.pageNumber } : {}),
        ...(options.pageSize !== undefined ? { pageSize: options.pageSize } : {}),
        ...(options.status !== undefined ? { status: options.status } : {}),
        ...(effectiveLE !== undefined ? { legalEntityId: effectiveLE } : {}),
        ...(siteCode ? { siteCode } : {}),
        ...(options.saasToken !== undefined ? { saasToken: options.saasToken } : {}),
      }),
  });
}
```

- [ ] **Step 4: Run, expect pass**

Run: `cd packages/react && pnpm exec vitest run tests/use-my-orders.test.tsx`
Expected: PASS — 5 tests green.

- [ ] **Step 5: Write the failing `use-my-orders-infinite` test**

`packages/react/tests/use-my-orders-infinite.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useMyOrdersInfinite } from "../src/hooks/use-my-orders-infinite";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({ access_token: "anon", token_type: "Bearer", expires_in: 3599, refresh_token: "r", sessionId: "s" }),
  ),
  http.get("https://api.emporix.io/customer-management/acme/legal-entities", () => HttpResponse.json([])),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap(storage = createMemoryStorage({ initial: "cust" })) {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={new QueryClient()}>
      {children}
    </EmporixProvider>
  );
}

describe("useMyOrdersInfinite", () => {
  it("paginates via hasNextPage and concatenates pages", async () => {
    server.use(
      http.get("https://api.emporix.io/order-v2/acme/orders", ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get("pageNumber") ?? "1");
        if (page === 1) {
          return HttpResponse.json({
            items: [{ id: "o-1", orderNumber: "ORD-1", status: "CREATED", currency: "CHF", totalPrice: { amount: 10, currency: "CHF" }, items: [] }],
            pageNumber: 1, pageSize: 1, hasNextPage: true,
          });
        }
        return HttpResponse.json({
          items: [{ id: "o-2", orderNumber: "ORD-2", status: "CREATED", currency: "CHF", totalPrice: { amount: 20, currency: "CHF" }, items: [] }],
          pageNumber: 2, pageSize: 1, hasNextPage: false,
        });
      }),
    );
    const { result } = renderHook(() => useMyOrdersInfinite({ pageSize: 1 }), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    const all = result.current.data?.pages.flatMap((p) => p.items) ?? [];
    expect(all.map((o) => o.id)).toEqual(["o-1", "o-2"]);
  });
});
```

- [ ] **Step 6: Implement `useMyOrdersInfinite`**

`packages/react/src/hooks/use-my-orders-infinite.ts`:

```ts
import type { UseInfiniteQueryResult } from "@tanstack/react-query";
import { auth, type Order, type OrderStatus, type PaginatedItems } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useActiveCompany } from "../company-context";
import { useEmporixInfinite } from "./internal/use-emporix-infinite";
import { emporixKey } from "./internal/query-keys";
import { useReadSite } from "./internal/use-read-site";

export interface UseMyOrdersInfiniteOptions {
  pageSize?: number;
  status?: OrderStatus;
  legalEntityId?: string | null;
  saasToken?: string;
}

/** Infinite paginated read of customer orders. Same defaulting rules as useMyOrders. */
export function useMyOrdersInfinite(
  options: UseMyOrdersInfiniteOptions = {},
): UseInfiniteQueryResult<{ pages: PaginatedItems<Order>[]; pageParams: number[] }> {
  const { client, storage } = useEmporix();
  const { activeCompany } = useActiveCompany();
  const { siteCode } = useReadSite();
  const token = storage.getCustomerToken();
  const effectiveLE: string | undefined =
    options.legalEntityId === null
      ? undefined
      : options.legalEntityId ?? activeCompany?.id;
  return useEmporixInfinite<Order>({
    queryKey: emporixKey(
      "orders",
      ["mine-infinite", effectiveLE ?? null, options.status ?? null, options.pageSize ?? null],
      { tenant: client.tenant, authKind: token ? "customer" : "anonymous", siteCode },
    ),
    enabled: token !== null,
    fetchPage: (pageNumber) =>
      client.orders.listMine(auth.customer(token as string), {
        pageNumber,
        ...(options.pageSize !== undefined ? { pageSize: options.pageSize } : {}),
        ...(options.status !== undefined ? { status: options.status } : {}),
        ...(effectiveLE !== undefined ? { legalEntityId: effectiveLE } : {}),
        ...(siteCode ? { siteCode } : {}),
        ...(options.saasToken !== undefined ? { saasToken: options.saasToken } : {}),
      }),
  });
}
```

- [ ] **Step 7: Export from hooks index**

In `packages/react/src/hooks/index.ts`, add:

```ts
export { useMyOrders } from "./use-my-orders";
export type { UseMyOrdersOptions } from "./use-my-orders";
export { useMyOrdersInfinite } from "./use-my-orders-infinite";
export type { UseMyOrdersInfiniteOptions } from "./use-my-orders-infinite";
```

- [ ] **Step 8: Re-export from package root**

In `packages/react/src/index.ts`, extend the existing `export { … } from "./hooks/index"` block to include `useMyOrders` and `useMyOrdersInfinite`.

- [ ] **Step 9: Build SDK + run all React tests**

```
pnpm -F @viu/emporix-sdk build
cd packages/react && pnpm exec vitest run tests/use-my-orders.test.tsx tests/use-my-orders-infinite.test.tsx
```
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/react/src/hooks/use-my-orders.ts packages/react/src/hooks/use-my-orders-infinite.ts packages/react/src/hooks/index.ts packages/react/src/index.ts packages/react/tests/use-my-orders.test.tsx packages/react/tests/use-my-orders-infinite.test.tsx
git commit -m "feat(react): add useMyOrders + useMyOrdersInfinite hooks

Paginated + infinite reads of the customer's own orders. Default
legalEntityId comes from useActiveCompany; explicit null disables.
Disabled without a customer token. Forwards pagination, status,
saasToken to the SDK.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `useOrder` + `useCancelOrder` + `useOrderTransition` hooks

**Files:**
- Create: `packages/react/src/hooks/use-order.ts`
- Create: `packages/react/src/hooks/use-cancel-order.ts`
- Create: `packages/react/src/hooks/use-order-transition.ts`
- Create: `packages/react/tests/use-order.test.tsx`
- Create: `packages/react/tests/use-cancel-order.test.tsx`
- Create: `packages/react/tests/use-order-transition.test.tsx`
- Modify: `packages/react/src/hooks/index.ts`
- Modify: `packages/react/src/index.ts`

- [ ] **Step 1: Write the failing `use-order` test**

`packages/react/tests/use-order.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useOrder } from "../src/hooks/use-order";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({ access_token: "anon", token_type: "Bearer", expires_in: 3599, refresh_token: "r", sessionId: "s" }),
  ),
  http.get("https://api.emporix.io/customer-management/acme/legal-entities", () => HttpResponse.json([])),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap(storage = createMemoryStorage({ initial: "cust" })) {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={new QueryClient()}>
      {children}
    </EmporixProvider>
  );
}

describe("useOrder", () => {
  it("is disabled when orderId is undefined", () => {
    const { result } = renderHook(() => useOrder(undefined), { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("fetches a single order", async () => {
    server.use(
      http.get("https://api.emporix.io/order-v2/acme/orders/o-1", () =>
        HttpResponse.json({ id: "o-1", orderNumber: "ORD-1", status: "CREATED", currency: "CHF", totalPrice: { amount: 10, currency: "CHF" }, items: [] }),
      ),
    );
    const { result } = renderHook(() => useOrder("o-1"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.orderNumber).toBe("ORD-1");
  });
});
```

- [ ] **Step 2: Implement `useOrder`**

`packages/react/src/hooks/use-order.ts`:

```ts
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { auth, type Order } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { emporixKey } from "./internal/query-keys";

export interface UseOrderOptions {
  saasToken?: string;
}

/** Single-order read by id. Disabled without a customer token or when orderId is undefined. */
export function useOrder(
  orderId: string | undefined,
  options: UseOrderOptions = {},
): UseQueryResult<Order> {
  const { client, storage } = useEmporix();
  const token = storage.getCustomerToken();
  return useQuery({
    queryKey: emporixKey("orders", [orderId ?? null], {
      tenant: client.tenant,
      authKind: token ? "customer" : "anonymous",
    }),
    enabled: token !== null && orderId !== undefined,
    queryFn: () =>
      client.orders.get(
        orderId as string,
        auth.customer(token as string),
        options.saasToken ? { saasToken: options.saasToken } : {},
      ),
  });
}
```

- [ ] **Step 3: Write the failing `use-cancel-order` test**

`packages/react/tests/use-cancel-order.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useCancelOrder } from "../src/hooks/use-cancel-order";
import { useMyOrders } from "../src/hooks/use-my-orders";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({ access_token: "anon", token_type: "Bearer", expires_in: 3599, refresh_token: "r", sessionId: "s" }),
  ),
  http.get("https://api.emporix.io/customer-management/acme/legal-entities", () => HttpResponse.json([])),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap() {
  const storage = createMemoryStorage({ initial: "cust" });
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
  return { Wrapper, queryClient };
}

describe("useCancelOrder", () => {
  it("POSTs DECLINED to /orders/{id}/transitions", async () => {
    const { Wrapper } = wrap();
    let body: unknown = null;
    server.use(
      http.post("https://api.emporix.io/order-v2/acme/orders/o-1/transitions", async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { result } = renderHook(() => useCancelOrder(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync("o-1");
    });
    expect(body).toEqual({ status: "DECLINED" });
  });

  it("invalidates useMyOrders after success", async () => {
    const { Wrapper } = wrap();
    let listCalls = 0;
    server.use(
      http.get("https://api.emporix.io/order-v2/acme/orders", () => {
        listCalls += 1;
        return HttpResponse.json({ items: [], pageNumber: 1, pageSize: 10, hasNextPage: false });
      }),
      http.post("https://api.emporix.io/order-v2/acme/orders/o-1/transitions", () =>
        new HttpResponse(null, { status: 204 }),
      ),
    );
    const { result } = renderHook(
      () => ({ list: useMyOrders(), cancel: useCancelOrder() }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    const before = listCalls;
    await act(async () => {
      await result.current.cancel.mutateAsync("o-1");
    });
    await waitFor(() => expect(listCalls).toBeGreaterThan(before));
  });
});
```

- [ ] **Step 4: Implement `useCancelOrder`**

`packages/react/src/hooks/use-cancel-order.ts`:

```ts
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { auth } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";

export interface UseCancelOrderVars {
  orderId: string;
  saasToken?: string;
}

/** Cancels (transitions to DECLINED) a customer's order. Invalidates ["emporix","orders"] on success. */
export function useCancelOrder(): UseMutationResult<void, unknown, string | UseCancelOrderVars> {
  const { client, storage } = useEmporix();
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["emporix", "orders", "cancel"],
    mutationFn: async (input) => {
      const token = storage.getCustomerToken();
      if (!token) throw new Error("useCancelOrder: requires a logged-in customer");
      const { orderId, saasToken } =
        typeof input === "string" ? { orderId: input, saasToken: undefined } : input;
      await client.orders.cancel(
        orderId,
        auth.customer(token),
        saasToken ? { saasToken } : {},
      );
    },
    onSuccess: () =>
      qc.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) && q.queryKey[1] === "orders",
      }),
  });
}
```

- [ ] **Step 5: Write the failing `use-order-transition` test**

`packages/react/tests/use-order-transition.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useOrderTransition } from "../src/hooks/use-order-transition";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({ access_token: "anon", token_type: "Bearer", expires_in: 3599, refresh_token: "r", sessionId: "s" }),
  ),
  http.get("https://api.emporix.io/customer-management/acme/legal-entities", () => HttpResponse.json([])),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap() {
  const storage = createMemoryStorage({ initial: "cust" });
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={new QueryClient()}>
      {children}
    </EmporixProvider>
  );
}

describe("useOrderTransition", () => {
  it("POSTs the explicit status + comment", async () => {
    let body: unknown = null;
    server.use(
      http.post("https://api.emporix.io/order-v2/acme/orders/o-1/transitions", async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { result } = renderHook(() => useOrderTransition(), { wrapper: wrap() });
    await act(async () => {
      await result.current.mutateAsync({ orderId: "o-1", status: "DECLINED", comment: "duplicate" });
    });
    expect(body).toEqual({ status: "DECLINED", comment: "duplicate" });
  });
});
```

- [ ] **Step 6: Implement `useOrderTransition`**

`packages/react/src/hooks/use-order-transition.ts`:

```ts
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { auth, type OrderStatus } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";

export interface UseOrderTransitionVars {
  orderId: string;
  status: OrderStatus;
  comment?: string;
  saasToken?: string;
}

/** Generic status transition. Server enforces legality. Invalidates ["emporix","orders"] on success. */
export function useOrderTransition(): UseMutationResult<void, unknown, UseOrderTransitionVars> {
  const { client, storage } = useEmporix();
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["emporix", "orders", "transition"],
    mutationFn: async ({ orderId, status, comment, saasToken }) => {
      const token = storage.getCustomerToken();
      if (!token) throw new Error("useOrderTransition: requires a logged-in customer");
      await client.orders.transition(
        orderId,
        status,
        auth.customer(token),
        {
          ...(comment !== undefined ? { comment } : {}),
          ...(saasToken !== undefined ? { saasToken } : {}),
        },
      );
    },
    onSuccess: () =>
      qc.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) && q.queryKey[1] === "orders",
      }),
  });
}
```

- [ ] **Step 7: Export from hooks index + root**

In `packages/react/src/hooks/index.ts`:

```ts
export { useOrder } from "./use-order";
export type { UseOrderOptions } from "./use-order";
export { useCancelOrder } from "./use-cancel-order";
export type { UseCancelOrderVars } from "./use-cancel-order";
export { useOrderTransition } from "./use-order-transition";
export type { UseOrderTransitionVars } from "./use-order-transition";
```

In `packages/react/src/index.ts`, add `useOrder`, `useCancelOrder`, `useOrderTransition` to the existing `export { … } from "./hooks/index"` block.

- [ ] **Step 8: Run all new tests**

```
pnpm -F @viu/emporix-sdk build
cd packages/react && pnpm exec vitest run tests/use-order.test.tsx tests/use-cancel-order.test.tsx tests/use-order-transition.test.tsx
```
Expected: PASS — 5 tests.

- [ ] **Step 9: Commit**

```bash
git add packages/react/src/hooks/use-order.ts packages/react/src/hooks/use-cancel-order.ts packages/react/src/hooks/use-order-transition.ts packages/react/src/hooks/index.ts packages/react/src/index.ts packages/react/tests/use-order.test.tsx packages/react/tests/use-cancel-order.test.tsx packages/react/tests/use-order-transition.test.tsx
git commit -m "feat(react): add useOrder + useCancelOrder + useOrderTransition

Single-order read disabled until orderId is provided and a customer
token is stored. Cancel and transition mutations invalidate any
['emporix','orders',…] query key on success.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `useReorder` hook

**Files:**
- Create: `packages/react/src/hooks/use-reorder.ts`
- Create: `packages/react/tests/use-reorder.test.tsx`
- Modify: `packages/react/src/hooks/index.ts`
- Modify: `packages/react/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/react/tests/use-reorder.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useReorder } from "../src/hooks/use-reorder";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({ access_token: "anon", token_type: "Bearer", expires_in: 3599, refresh_token: "r", sessionId: "s" }),
  ),
  http.get("https://api.emporix.io/customer-management/acme/legal-entities", () => HttpResponse.json([])),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap() {
  const storage = createMemoryStorage({ initial: "cust" });
  storage.setCartId("cart-1");
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={new QueryClient()}>
      {children}
    </EmporixProvider>
  );
}

describe("useReorder", () => {
  it("fetches order, adds each item to cart, returns { added }", async () => {
    const added: unknown[] = [];
    server.use(
      http.get("https://api.emporix.io/order-v2/acme/orders/o-1", () =>
        HttpResponse.json({
          id: "o-1", orderNumber: "ORD-1", status: "COMPLETED", currency: "CHF",
          totalPrice: { amount: 30, currency: "CHF" },
          items: [
            { id: "i1", productId: "p-1", quantity: 2, unitPrice: { amount: 10, currency: "CHF" }, totalPrice: { amount: 20, currency: "CHF" } },
            { id: "i2", productId: "p-2", quantity: 1, unitPrice: { amount: 10, currency: "CHF" }, totalPrice: { amount: 10, currency: "CHF" } },
          ],
        }),
      ),
      http.post("https://api.emporix.io/cart/acme/carts/cart-1/items", async ({ request }) => {
        added.push(await request.json());
        return HttpResponse.json({ id: "cart-1", items: [] });
      }),
    );
    const { result } = renderHook(() => useReorder(), { wrapper: wrap() });
    let res: { added: number; errors: unknown[] } | undefined;
    await act(async () => {
      res = await result.current.mutateAsync({ orderId: "o-1" });
    });
    expect(res?.added).toBe(2);
    expect(res?.errors).toEqual([]);
    expect(added).toHaveLength(2);
    expect(added[0]).toMatchObject({ product: { id: "p-1" }, quantity: 2 });
    expect(added[1]).toMatchObject({ product: { id: "p-2" }, quantity: 1 });
  });

  it("collects errors but does not throw on item-level failures", async () => {
    server.use(
      http.get("https://api.emporix.io/order-v2/acme/orders/o-1", () =>
        HttpResponse.json({
          id: "o-1", orderNumber: "ORD-1", status: "COMPLETED", currency: "CHF",
          totalPrice: { amount: 20, currency: "CHF" },
          items: [
            { id: "i1", productId: "p-ok", quantity: 1, unitPrice: { amount: 10, currency: "CHF" }, totalPrice: { amount: 10, currency: "CHF" } },
            { id: "i2", productId: "p-gone", quantity: 1, unitPrice: { amount: 10, currency: "CHF" }, totalPrice: { amount: 10, currency: "CHF" } },
          ],
        }),
      ),
      http.post("https://api.emporix.io/cart/acme/carts/cart-1/items", async ({ request }) => {
        const body = (await request.json()) as { product?: { id?: string } };
        if (body.product?.id === "p-gone") return HttpResponse.json({ message: "discontinued" }, { status: 404 });
        return HttpResponse.json({ id: "cart-1", items: [] });
      }),
    );
    const { result } = renderHook(() => useReorder(), { wrapper: wrap() });
    let res: { added: number; errors: unknown[] } | undefined;
    await act(async () => {
      res = await result.current.mutateAsync({ orderId: "o-1" });
    });
    expect(res?.added).toBe(1);
    expect(res?.errors).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `cd packages/react && pnpm exec vitest run tests/use-reorder.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `useReorder`**

`packages/react/src/hooks/use-reorder.ts`:

```ts
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { auth, type Order } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { emporixKey } from "./internal/query-keys";

export interface UseReorderVars {
  orderId: string;
  saasToken?: string;
}

export interface UseReorderResult {
  added: number;
  errors: unknown[];
}

/**
 * Re-populates the active cart from a past order. Best-effort: each
 * `cart.addItem` runs sequentially; item-level failures are collected in
 * `errors[]` instead of throwing. Returns `{ added, errors }`.
 */
export function useReorder(): UseMutationResult<UseReorderResult, unknown, UseReorderVars> {
  const { client, storage } = useEmporix();
  const qc = useQueryClient();
  return useMutation<UseReorderResult, unknown, UseReorderVars>({
    mutationKey: ["emporix", "orders", "reorder"],
    mutationFn: async ({ orderId, saasToken }) => {
      const token = storage.getCustomerToken();
      if (!token) throw new Error("useReorder: requires a logged-in customer");
      const ctx = auth.customer(token);

      const order = await qc.fetchQuery<Order>({
        queryKey: emporixKey("orders", [orderId], { tenant: client.tenant, authKind: ctx.kind }),
        queryFn: () =>
          client.orders.get(orderId, ctx, saasToken ? { saasToken } : {}),
      });

      const cartId = storage.getCartId();
      if (!cartId) throw new Error("useReorder: no active cart id in storage");

      let added = 0;
      const errors: unknown[] = [];
      for (const item of order.items) {
        try {
          await client.carts.addItem(
            cartId,
            { product: { id: item.productId }, quantity: item.quantity } as never,
            ctx,
          );
          added += 1;
        } catch (e) {
          errors.push(e);
        }
      }
      return { added, errors };
    },
    onSuccess: () => {
      qc.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[1] === "cart" });
    },
  });
}
```

- [ ] **Step 4: Export from hooks index + root**

In `packages/react/src/hooks/index.ts`:

```ts
export { useReorder } from "./use-reorder";
export type { UseReorderVars, UseReorderResult } from "./use-reorder";
```

In `packages/react/src/index.ts`, add `useReorder` to the existing block.

- [ ] **Step 5: Run, expect pass**

```
pnpm -F @viu/emporix-sdk build
cd packages/react && pnpm exec vitest run tests/use-reorder.test.tsx
```
Expected: PASS — 2 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/hooks/use-reorder.ts packages/react/src/hooks/index.ts packages/react/src/index.ts packages/react/tests/use-reorder.test.tsx
git commit -m "feat(react): add useReorder helper (best-effort cart repopulation)

Fetches the target order, iterates line-items, calls cart.addItem
sequentially. Item-level failures land in errors[] instead of
throwing; mutation result shape: { added, errors }.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: `useSalesOrder` + `useUpdateSalesOrder` hooks

**Files:**
- Create: `packages/react/src/hooks/use-sales-order.ts`
- Create: `packages/react/src/hooks/use-update-sales-order.ts`
- Create: `packages/react/tests/use-sales-order.test.tsx`
- Create: `packages/react/tests/use-update-sales-order.test.tsx`
- Modify: `packages/react/src/hooks/index.ts`
- Modify: `packages/react/src/index.ts`

- [ ] **Step 1: Write the failing `use-sales-order` test**

`packages/react/tests/use-sales-order.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { auth, EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useSalesOrder } from "../src/hooks/use-sales-order";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({ access_token: "anon", token_type: "Bearer", expires_in: 3599, refresh_token: "r", sessionId: "s" }),
  ),
  http.get("https://api.emporix.io/customer-management/acme/legal-entities", () => HttpResponse.json([])),
  http.post("https://api.emporix.io/oauth/token", () =>
    HttpResponse.json({ access_token: "svc-tok", expires_in: 3600 }),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap() {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: {
      backend: { clientId: "b", secret: "s" },
      storefront: { clientId: "sf" },
    },
    logger: false,
  });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={createMemoryStorage()} queryClient={new QueryClient()}>
      {children}
    </EmporixProvider>
  );
}

describe("useSalesOrder", () => {
  it("is disabled when auth is undefined", () => {
    const { result } = renderHook(() => useSalesOrder("o-1", undefined), { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("fetches /salesorders/{id} with the provided service context", async () => {
    server.use(
      http.get("https://api.emporix.io/order-v2/acme/salesorders/o-1", () =>
        HttpResponse.json({
          id: "o-1", orderNumber: "ORD-1", status: "CONFIRMED",
          currency: "CHF", totalPrice: { amount: 50, currency: "CHF" }, items: [],
        }),
      ),
    );
    const { result } = renderHook(
      () => useSalesOrder("o-1", auth.service()),
      { wrapper: wrap() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.status).toBe("CONFIRMED");
  });
});
```

- [ ] **Step 2: Implement `useSalesOrder`**

`packages/react/src/hooks/use-sales-order.ts`:

```ts
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { type AuthContext, type Order } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { emporixKey } from "./internal/query-keys";

/** Service-account read of a single sales-order. Disabled when `auth` is undefined. */
export function useSalesOrder(
  orderId: string | undefined,
  authCtx: AuthContext | undefined,
): UseQueryResult<Order> {
  const { client } = useEmporix();
  return useQuery({
    queryKey: emporixKey("salesorders", [orderId ?? null], {
      tenant: client.tenant,
      authKind: authCtx?.kind ?? "anonymous",
    }),
    enabled: orderId !== undefined && authCtx !== undefined,
    queryFn: () => client.salesOrders.get(orderId as string, authCtx as AuthContext),
  });
}
```

- [ ] **Step 3: Write the failing `use-update-sales-order` test**

`packages/react/tests/use-update-sales-order.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { auth, EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useUpdateSalesOrder } from "../src/hooks/use-update-sales-order";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({ access_token: "anon", token_type: "Bearer", expires_in: 3599, refresh_token: "r", sessionId: "s" }),
  ),
  http.get("https://api.emporix.io/customer-management/acme/legal-entities", () => HttpResponse.json([])),
  http.post("https://api.emporix.io/oauth/token", () =>
    HttpResponse.json({ access_token: "svc-tok", expires_in: 3600 }),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap() {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: {
      backend: { clientId: "b", secret: "s" },
      storefront: { clientId: "sf" },
    },
    logger: false,
  });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={createMemoryStorage()} queryClient={new QueryClient()}>
      {children}
    </EmporixProvider>
  );
}

describe("useUpdateSalesOrder", () => {
  it("PATCHes the order and returns the updated body", async () => {
    server.use(
      http.patch("https://api.emporix.io/order-v2/acme/salesorders/o-1", () =>
        HttpResponse.json({
          id: "o-1", orderNumber: "ORD-1", status: "SHIPPED",
          currency: "CHF", totalPrice: { amount: 50, currency: "CHF" }, items: [],
        }),
      ),
    );
    const { result } = renderHook(() => useUpdateSalesOrder(), { wrapper: wrap() });
    let r: unknown;
    await act(async () => {
      r = await result.current.mutateAsync({
        orderId: "o-1",
        patch: { status: "SHIPPED" },
        auth: auth.service(),
      });
    });
    expect((r as { status?: string }).status).toBe("SHIPPED");
  });

  it("throws synchronously when auth is missing", async () => {
    const { result } = renderHook(() => useUpdateSalesOrder(), { wrapper: wrap() });
    await expect(
      result.current.mutateAsync({
        orderId: "o-1",
        patch: { status: "SHIPPED" },
        auth: undefined as unknown as ReturnType<typeof auth.service>,
      }),
    ).rejects.toThrow(/requires.*auth/i);
  });
});
```

- [ ] **Step 4: Implement `useUpdateSalesOrder`**

`packages/react/src/hooks/use-update-sales-order.ts`:

```ts
import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { type AuthContext, type Order, type SalesOrderPatch } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";

export interface UseUpdateSalesOrderVars {
  orderId: string;
  patch: SalesOrderPatch;
  auth: AuthContext;
  recalculate?: boolean;
}

/**
 * Service-account update of a sales-order. Invalidates both
 * ["emporix","salesorders",id] and ["emporix","orders",id] (the customer-view
 * cache for the same order) on success.
 */
export function useUpdateSalesOrder(): UseMutationResult<Order, unknown, UseUpdateSalesOrderVars> {
  const { client } = useEmporix();
  const qc = useQueryClient();
  return useMutation<Order, unknown, UseUpdateSalesOrderVars>({
    mutationKey: ["emporix", "salesorders", "update"],
    mutationFn: async ({ orderId, patch, auth, recalculate }) => {
      if (!auth) throw new Error("useUpdateSalesOrder: requires an auth context");
      return client.salesOrders.update(
        orderId,
        patch,
        auth,
        recalculate !== undefined ? { recalculate } : {},
      );
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          (q.queryKey[1] === "salesorders" || (q.queryKey[1] === "orders" && q.queryKey[2] === vars.orderId)),
      });
    },
  });
}
```

- [ ] **Step 5: Export from hooks index + root**

In `packages/react/src/hooks/index.ts`:

```ts
export { useSalesOrder } from "./use-sales-order";
export { useUpdateSalesOrder } from "./use-update-sales-order";
export type { UseUpdateSalesOrderVars } from "./use-update-sales-order";
```

In `packages/react/src/index.ts`, add `useSalesOrder` and `useUpdateSalesOrder`.

- [ ] **Step 6: Run, expect pass**

```
pnpm -F @viu/emporix-sdk build
cd packages/react && pnpm exec vitest run tests/use-sales-order.test.tsx tests/use-update-sales-order.test.tsx
```
Expected: PASS — 4 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/hooks/use-sales-order.ts packages/react/src/hooks/use-update-sales-order.ts packages/react/src/hooks/index.ts packages/react/src/index.ts packages/react/tests/use-sales-order.test.tsx packages/react/tests/use-update-sales-order.test.tsx
git commit -m "feat(react): add useSalesOrder + useUpdateSalesOrder hooks

Service-account read + patch on /salesorders/{id}. Both hooks are
inert without an explicit AuthContext (no implicit auth.service()
default) so storefront apps can import them safely for types.
Update invalidates the salesorder + matching customer-order keys.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: B2B-switch regression test

**Files:**
- Create: `packages/react/tests/use-my-orders-b2b.test.tsx`

- [ ] **Step 1: Write the test**

`packages/react/tests/use-my-orders-b2b.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useMyOrders } from "../src/hooks/use-my-orders";
import { useActiveCompany } from "../src/company-context";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({ access_token: "anon", token_type: "Bearer", expires_in: 3599, refresh_token: "r", sessionId: "s" }),
  ),
  http.get("https://api.emporix.io/customer-management/acme/legal-entities", () =>
    HttpResponse.json([
      { id: "le-1", name: "Acme", type: "COMPANY" },
      { id: "le-2", name: "Globex", type: "COMPANY" },
    ]),
  ),
  http.get("https://api.emporix.io/customer/acme/refreshauthtoken", () =>
    HttpResponse.json({ access_token: "scoped", refresh_token: "r2" }),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("useMyOrders B2B switch", () => {
  it("re-fetches when the active company changes", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    storage.setRefreshToken("r");
    const calls: Array<string | null> = [];
    server.use(
      http.get("https://api.emporix.io/order-v2/acme/orders", ({ request }) => {
        calls.push(new URL(request.url).searchParams.get("legalEntityId"));
        return HttpResponse.json({ items: [], pageNumber: 1, pageSize: 10, hasNextPage: false });
      }),
    );
    const client = new EmporixClient({
      tenant: "acme",
      credentials: { storefront: { clientId: "sf" } },
      logger: false,
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
        {children}
      </EmporixProvider>
    );
    const { result } = renderHook(
      () => ({ orders: useMyOrders(), company: useActiveCompany() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.company.myCompanies).toHaveLength(2));
    // Pick le-1 first.
    await act(async () => {
      await result.current.company.setActiveCompany("le-1");
    });
    await waitFor(() => expect(calls).toContain("le-1"));
    // Switch to le-2 — orders query key must include "le-2" → new fetch.
    await act(async () => {
      await result.current.company.setActiveCompany("le-2");
    });
    await waitFor(() => expect(calls).toContain("le-2"));
  });
});
```

- [ ] **Step 2: Run, expect pass**

```
pnpm -F @viu/emporix-sdk build
cd packages/react && pnpm exec vitest run tests/use-my-orders-b2b.test.tsx
```
Expected: PASS — 1 test.

- [ ] **Step 3: Commit**

```bash
git add packages/react/tests/use-my-orders-b2b.test.tsx
git commit -m "test(react): pin company-switch invalidates useMyOrders

Regression-pin that the legalEntityId in the orders mine-key is the
trigger for refetch when setActiveCompany changes the active LE.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: `examples/vite-spa` — Order History + Detail pages

**Files:**
- Create: `examples/vite-spa/src/pages/OrderHistory.tsx`
- Create: `examples/vite-spa/src/pages/OrderDetail.tsx`
- Modify: `examples/vite-spa/src/App.tsx`

- [ ] **Step 1: Create the history page**

`examples/vite-spa/src/pages/OrderHistory.tsx`:

```tsx
import { Link } from "react-router-dom";
import { useMyOrdersInfinite } from "@viu/emporix-sdk-react";

export function OrderHistory(): React.JSX.Element {
  const { data, isLoading, isFetchingNextPage, fetchNextPage, hasNextPage } =
    useMyOrdersInfinite({ pageSize: 10 });
  if (isLoading) return <p>Loading…</p>;
  const orders = data?.pages.flatMap((p) => p.items) ?? [];
  if (orders.length === 0) return <p>No orders yet.</p>;
  return (
    <section>
      <h2>My Orders</h2>
      <ul>
        {orders.map((o) => (
          <li key={o.id}>
            <Link to={`/account/orders/${o.id}`}>
              {o.orderNumber} — {o.status} — {o.totalPrice.amount} {o.totalPrice.currency}
            </Link>
          </li>
        ))}
      </ul>
      {hasNextPage && (
        <button onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}>
          {isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Create the detail page**

`examples/vite-spa/src/pages/OrderDetail.tsx`:

```tsx
import { useState } from "react";
import { useParams } from "react-router-dom";
import { useOrder, useCancelOrder, useReorder } from "@viu/emporix-sdk-react";

function displayProductName(name: unknown, fallback: string): string {
  if (typeof name === "string") return name;
  if (name && typeof name === "object") {
    const values = Object.values(name as Record<string, unknown>);
    if (typeof values[0] === "string") return values[0];
  }
  return fallback;
}

export function OrderDetail(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { data: order, isLoading } = useOrder(id);
  const cancel = useCancelOrder();
  const reorder = useReorder();
  const [reorderResult, setReorderResult] = useState<{ added: number; errors: number } | null>(null);

  if (isLoading || !order) return <p>Loading…</p>;
  const canCancel = order.status === "CREATED";
  return (
    <section>
      <h2>Order {order.orderNumber}</h2>
      <p>Status: {order.status}</p>
      <p>Total: {order.totalPrice.amount} {order.totalPrice.currency}</p>
      <h3>Items</h3>
      <ul>
        {order.items.map((it) => (
          <li key={it.id}>
            {displayProductName(it.productName, it.productId)} × {it.quantity} — {it.totalPrice.amount} {it.totalPrice.currency}
          </li>
        ))}
      </ul>
      {canCancel && (
        <button
          disabled={cancel.isPending}
          onClick={() => void cancel.mutateAsync(order.id)}
        >
          {cancel.isPending ? "Cancelling…" : "Cancel order"}
        </button>
      )}
      <button
        disabled={reorder.isPending}
        onClick={async () => {
          const r = await reorder.mutateAsync({ orderId: order.id });
          setReorderResult({ added: r.added, errors: r.errors.length });
        }}
      >
        {reorder.isPending ? "Reordering…" : "Reorder"}
      </button>
      {reorderResult && (
        <p>
          Added {reorderResult.added} item(s) to cart.
          {reorderResult.errors > 0 && ` ${reorderResult.errors} could not be re-added.`}
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Wire routes**

In `examples/vite-spa/src/App.tsx`, add imports near the top:

```tsx
import { OrderHistory } from "./pages/OrderHistory";
import { OrderDetail } from "./pages/OrderDetail";
```

In the `<Routes>` block, add the two routes (alongside the existing `/`, `/account`, `/guest` entries):

```tsx
<Route path="/account/orders" element={<OrderHistory />} />
<Route path="/account/orders/:id" element={<OrderDetail />} />
```

In the `<nav>` block, add a link:

```tsx
| <Link to="/account/orders">My orders</Link>
```

- [ ] **Step 4: Build packages, typecheck example**

```
pnpm -F @viu/emporix-sdk build
pnpm -F @viu/emporix-sdk-react build
pnpm -F @viu/emporix-examples-vite-spa typecheck
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add examples/vite-spa/src/pages/OrderHistory.tsx examples/vite-spa/src/pages/OrderDetail.tsx examples/vite-spa/src/App.tsx
git commit -m "feat(examples): add order history + detail pages to vite-spa

useMyOrdersInfinite paginated list at /account/orders; useOrder +
useCancelOrder + useReorder on /account/orders/:id. Cancel button is
visible only when status === 'CREATED'; reorder result surfaces the
partial-success { added, errors } shape.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Docs

**Files:**
- Create: `docs/orders.md`
- Modify: `docs/auth.md`
- Modify: `docs/react.md`
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] **Step 1: Write `docs/orders.md`**

```markdown
# Orders

> Available since `@viu/emporix-sdk@<next minor>` and `@viu/emporix-sdk-react@<next minor>`.

## Concepts

- **Order** — a paid or pending shopping outcome with an `OrderStatus`: `CREATED`, `IN_CHECKOUT`, `CONFIRMED`, `SHIPPED`, `COMPLETED`, `DECLINED`.
- **Customer endpoints** (`/order-v2/{tenant}/orders/…`) — the storefront-user view. Customers can list/read their own orders, transition (e.g. `DECLINED` = cancel from `CREATED`).
- **Sales-order endpoints** (`/order-v2/{tenant}/salesorders/…`) — the merchant/service-account view. Backends patch status, mixins, and custom attributes after fulfilment.

## Status lifecycle

```
CREATED ─┬─ CONFIRMED ─ SHIPPED ─ COMPLETED
         └─ DECLINED
IN_CHECKOUT ─┬─ CREATED
             └─ DECLINED
```

`COMPLETED` and `DECLINED` are terminal. The SDK does **not** validate transitions clientside — the server rejects illegal moves with `EmporixValidationError` (HTTP 400/422).

## SDK

```ts
client.orders.listMine(auth, opts?)
client.orders.get(orderId, auth, opts?)
client.orders.transition(orderId, status, auth, opts?)
client.orders.cancel(orderId, auth, opts?)       // alias: transition(DECLINED)

client.salesOrders.get(orderId, auth)
client.salesOrders.update(orderId, patch, auth, opts?)
```

### saas-token (opt-in)

Some tenants require a `saas-token` header alongside the customer Bearer. Pass it via `opts.saasToken`:

```ts
await client.orders.listMine(ctx, { saasToken: customerSession.saasToken });
```

`useCustomerSession()` exposes the active session's `saasToken`; pass it explicitly to the hook/SDK call when needed (no implicit reach into session state).

## React hooks

```ts
useMyOrders({ pageSize?, status?, legalEntityId?, saasToken? })
useMyOrdersInfinite({ pageSize?, status?, legalEntityId?, saasToken? })
useOrder(orderId, { saasToken? })

useCancelOrder()                    // mutate(orderId | { orderId, saasToken })
useOrderTransition()                // mutate({ orderId, status, comment?, saasToken? })
useReorder()                        // mutate({ orderId, saasToken? }) → { added, errors }

useSalesOrder(orderId, auth)        // disabled when auth is undefined
useUpdateSalesOrder()               // mutate({ orderId, patch, auth, recalculate? })
```

### Active-company defaulting

`useMyOrders` and `useMyOrdersInfinite` read `legalEntityId` from `useActiveCompany()` when the option is undefined. Pass `legalEntityId: null` to disable the auto-default (see all orders regardless of context). Query keys include the effective id, so `setActiveCompany` invalidates the list automatically.

### Reorder partial-success

`useReorder` adds line-items to the active cart sequentially. Item-level failures (e.g. a discontinued product) are collected into `errors[]`; the mutation returns `{ added, errors }` instead of throwing. Surface both numbers in the UI.

## SSR

`prefetchOrder(qc, client, orderId, authCtx, opts?)` writes the same cache key `useOrder(orderId)` reads. Mirrors `prefetchProduct` / `prefetchCart`.

## Out of scope (follow-ups)

- B2B shared-orders (other company members' orders) — Sub-Spec #2.
- Full `/salesorders` list + filter + bulk — Sub-Spec #3.
- Order split (vendor marketplace) — Sub-Spec #4.
- Returns and order events — separate Emporix services, separate specs.
```

- [ ] **Step 2: Append to `docs/auth.md`**

Add a new section at the end:

```markdown
## `saas-token` on order reads

`client.orders.listMine` and `client.orders.get` accept an `opts.saasToken` that is forwarded as the `saas-token` header (mirrors `checkout.placeOrder`). For tenants that require dual-token reads, pass the `saasToken` returned by `customers.login`. See [docs/orders.md](./orders.md).
```

- [ ] **Step 3: Extend `docs/react.md`** with the orders hook list

Find the existing customer-account section and add a new subsection after it (placement: between "Customer account" and "Sites"):

```markdown
### Orders

`useMyOrders` / `useMyOrdersInfinite` — paginated reads of the customer's own orders. `legalEntityId` defaults to the active company from `useActiveCompany`; explicit `null` disables.

`useOrder(orderId)` — single-order read.

`useCancelOrder` / `useOrderTransition` — mutations. Cancel is a sugar for `transition(DECLINED)`.

`useReorder({ orderId })` → `{ added, errors }` — best-effort cart repopulation from a past order; item-level failures land in `errors[]` instead of throwing.

Service-account (backoffice tools): `useSalesOrder(id, auth)` and `useUpdateSalesOrder()` — disabled / throw when `auth` is undefined; caller is responsible for providing an `auth.service()` context.

See [`./orders.md`](./orders.md).
```

- [ ] **Step 4: Update `CLAUDE.md`** — workspace layout service list

Find the `packages/sdk` row in the workspace-layout table and add `, Orders, SalesOrders` to the service list (best-effort: match the current state of the row).

- [ ] **Step 5: Update root `README.md`** — package description

Find the `@viu/emporix-sdk` row in the packages table and append `, Orders, SalesOrders` (mirrors the CLAUDE.md update).

- [ ] **Step 6: Commit**

```bash
git add docs/orders.md docs/auth.md docs/react.md CLAUDE.md README.md
git commit -m "docs(docs): add orders.md and link from auth/react/claude/readme

Customer + sales-order surfaces, saas-token opt-in, active-company
defaulting, reorder partial-success, prefetchOrder SSR helper.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Changesets

**Files:**
- Create: `.changeset/order-service-foundation-sdk.md`
- Create: `.changeset/order-service-foundation-react.md`

- [ ] **Step 1: Write the SDK changeset**

`.changeset/order-service-foundation-sdk.md`:

```markdown
---
"@viu/emporix-sdk": minor
---

Order service (customer foundation):

- New `client.orders` — `listMine` / `get` / `transition` / `cancel` over the customer-facing `/order-v2/{tenant}/orders/*` endpoints. All methods accept an `opts.saasToken` forwarded as the `saas-token` header.
- New `client.salesOrders` — `get` / `update` over `/order-v2/{tenant}/salesorders/{id}` for backend / service-account use (status, mixins, custom attributes patches). `update` accepts `opts.recalculate` (server default `true`).
- New hand-rolled `Order`, `OrderItem`, `OrderStatus`, `OrderTransition`, `SalesOrderPatch` types (pending real codegen).
- New subpath export `@viu/emporix-sdk/orders`.

No breaking changes. The full `/salesorders` admin list, order split, returns, and order events are deferred sub-specs.
```

- [ ] **Step 2: Write the React changeset**

`.changeset/order-service-foundation-react.md`:

```markdown
---
"@viu/emporix-sdk-react": minor
---

Order service hooks:

- Customer-facing: `useMyOrders`, `useMyOrdersInfinite`, `useOrder`, `useCancelOrder`, `useOrderTransition`, `useReorder`.
- Service-account (backoffice): `useSalesOrder`, `useUpdateSalesOrder` — inert when `auth` is undefined so storefront apps can import them for types without unexpected backend traffic.
- New `prefetchOrder` SSR helper alongside `prefetchProduct` / `prefetchCart`.
- `useMyOrders` / `useMyOrdersInfinite` default `legalEntityId` from `useActiveCompany`; explicit `null` disables. Switching the active company auto-invalidates order queries because `legalEntityId` is part of the cache key.
- `useReorder` is best-effort: item-level failures during cart repopulation land in `errors[]` instead of throwing; the mutation returns `{ added, errors }`.
```

- [ ] **Step 3: Verify changeset status**

Run: `pnpm changeset status`
Expected: both packages listed (the changesets tool may label them under "major" because the packages are still at 0.x — that's expected, the changeset metadata says minor).

- [ ] **Step 4: Commit**

```bash
git add .changeset/order-service-foundation-sdk.md .changeset/order-service-foundation-react.md
git commit -m "chore(release): add order service foundation changesets

Two minor bumps — sdk gets orders + salesOrders services; react
gets seven hooks + prefetchOrder + company-aware order keys.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Final verification

- [ ] Run repo-wide checks

```
pnpm install
pnpm -r typecheck
pnpm -r lint
pnpm -r test
```
Expected: all green. SDK adds ~12 tests (orders.test + sales-orders.test + client.test); React adds ~11 tests.

- [ ] Build packages

```
pnpm -r build
```
Expected: PASS. `packages/sdk/dist/` contains `orders.{js,cjs,d.ts,d.cts}`.

- [ ] Examples typecheck

```
pnpm -F @viu/emporix-examples-vite-spa typecheck
pnpm -F @viu/emporix-examples-next-app-router typecheck
pnpm -F @viu/emporix-examples-node-server typecheck
```
Expected: all PASS.

- [ ] (Optional) Run e2e against `viu`

```
cd e2e && set -a && source .env.local && set +a && pnpm exec playwright test
```
Expected: existing 6 tests still pass (no new order specs in this slice).

- [ ] Push the branch + open the PR

```
git push -u origin feat/order-service-foundation
gh pr create --base main --title "feat: order service foundation" --body "$(cat <<'EOF'
Implements docs/superpowers/specs/2026-05-26-order-service-design.md.

See docs/superpowers/plans/2026-05-26-order-service-foundation.md for the
per-task breakdown.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
