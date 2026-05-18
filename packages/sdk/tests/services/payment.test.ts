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
