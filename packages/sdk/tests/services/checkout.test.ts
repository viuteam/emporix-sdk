import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { CheckoutService } from "../../src/services/checkout";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";
import { EmporixAuthError, EmporixError } from "../../src/core/errors";

let captured: { auth: string | null; saas: string | null; url: string; body: unknown } | null =
  null;
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
);
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  captured = null;
});
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
    { contactName: "A", street: "S", zipCode: "1", city: "B", country: "DE", type: "SHIPPING" as const },
    { contactName: "A", street: "S", zipCode: "1", city: "B", country: "DE", type: "BILLING" as const },
  ],
  paymentMethods: [{ provider: "none" as const, method: "invoice" }],
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
        return HttpResponse.json({
          orderId: b.quoteId ? "EONQ" : "X",
          paymentDetails: null,
          checkoutId: null,
        });
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
