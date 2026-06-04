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
        HttpResponse.json({
          id: "o-1",
          status: "CREATED",
          currency: "CHF",
          totalPrice: 10,
          entries: [
            { id: "e1", itemYrn: "urn:yaas:hybris:product:product:acme;p1", orderedAmount: 1, unitPrice: 10, totalPrice: 10 },
          ],
          customer: { id: "c1", email: "a@b.co" },
          mixins: { generalAttributes: { orderNumber: "ORD-1" } },
        }),
      ),
    );
    const r = await svc().get("o-1", CUST);
    expect(r.id).toBe("o-1");
    expect(r.status).toBe("CREATED");
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
