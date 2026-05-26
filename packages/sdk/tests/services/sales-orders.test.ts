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
