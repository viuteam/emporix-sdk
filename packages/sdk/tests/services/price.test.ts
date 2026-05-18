import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { PriceService } from "../../src/services/price";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";

let captured: { auth: string | null; body: unknown } | null = null;
const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon-tok", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
  http.post("https://api.emporix.io/oauth/token", () =>
    HttpResponse.json({ access_token: "svc-tok", token_type: "Bearer", expires_in: 3599 }),
  ),
  http.post("https://api.emporix.io/price/acme/match-prices-by-context", async ({ request }) => {
    captured = { auth: request.headers.get("authorization"), body: await request.json() };
    return HttpResponse.json([
      { priceId: "pr1", effectiveValue: 9.9, totalValue: 19.8, includesTax: true },
    ]);
  }),
  http.post("https://api.emporix.io/price/acme/match-prices", async ({ request }) => {
    captured = { auth: request.headers.get("authorization"), body: await request.json() };
    return HttpResponse.json([{ priceId: "pr2", effectiveValue: 5 }]);
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "price" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io", provider: tokenProvider, logger,
    retry: { maxAttempts: 1 }, timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new PriceService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

describe("PriceService.matchByContext", () => {
  it("POSTs items only, defaults to the anonymous token, returns the match array", async () => {
    const res = await svc().matchByContext([
      { itemId: { itemType: "PRODUCT", id: "p1" }, quantity: { quantity: 2 } },
    ]);
    expect(captured?.auth).toBe("Bearer anon-tok");
    expect(captured?.body).toEqual({
      items: [{ itemId: { itemType: "PRODUCT", id: "p1" }, quantity: { quantity: 2 } }],
    });
    expect(res[0]?.effectiveValue).toBe(9.9);
  });

  it("uses a customer token when given a customer AuthContext", async () => {
    await svc().matchByContext(
      [{ itemId: { itemType: "PRODUCT", id: "p1" }, quantity: { quantity: 1 } }],
      { kind: "customer", token: "cust-tok" },
    );
    expect(captured?.auth).toBe("Bearer cust-tok");
  });
});

describe("PriceService.match", () => {
  it("POSTs explicit context, defaults to the service token", async () => {
    const res = await svc().match({
      targetCurrency: "CHF",
      siteCode: "main",
      targetLocation: { countryCode: "CH" },
      items: [{ itemId: { itemType: "PRODUCT", id: "p1" }, quantity: { quantity: 1 } }],
    });
    expect(captured?.auth).toBe("Bearer svc-tok");
    expect(captured?.body).toMatchObject({ targetCurrency: "CHF", siteCode: "main" });
    expect(res[0]?.priceId).toBe("pr2");
  });
});
