import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { CurrencyService } from "../../src/services/currency";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "currency" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new CurrencyService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/currency/acme";

describe("CurrencyService", () => {
  it("listCurrencies GETs with a service token", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(`${BASE}/currencies`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json([{ code: "EUR" }]);
      }),
    );
    await svc().listCurrencies();
    expect(seenAuth).toBe("Bearer svc-tok");
  });

  it("getCurrency / createCurrency / updateCurrency / deleteCurrency", async () => {
    let created: unknown = null;
    let updated: unknown = null;
    server.use(
      http.get(`${BASE}/currencies/EUR`, () => HttpResponse.json({ code: "EUR" })),
      http.post(`${BASE}/currencies`, async ({ request }) => {
        created = await request.json();
        return HttpResponse.json({ code: "EUR" }, { status: 201 });
      }),
      http.put(`${BASE}/currencies/EUR`, async ({ request }) => {
        updated = await request.json();
        return HttpResponse.json({ code: "EUR" });
      }),
      http.delete(`${BASE}/currencies/EUR`, () => new HttpResponse(null, { status: 204 })),
    );
    expect((await svc().getCurrency("EUR")) as { code?: string }).toEqual({ code: "EUR" });
    await svc().createCurrency({ code: "EUR", name: "Euro" } as never);
    expect(created).toEqual({ code: "EUR", name: "Euro" });
    await svc().updateCurrency("EUR", { name: "Euro €" } as never);
    expect(updated).toEqual({ name: "Euro €" });
    await expect(svc().deleteCurrency("EUR")).resolves.toBeUndefined();
  });

  it("getCurrency throws EmporixNotFoundError on 404", async () => {
    server.use(http.get(`${BASE}/currencies/XX`, () => HttpResponse.json({ status: 404, message: "x" }, { status: 404 })));
    await expect(svc().getCurrency("XX")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("exchange rates: list / get / create / update / delete", async () => {
    let created: unknown = null;
    server.use(
      http.get(`${BASE}/exchanges`, () => HttpResponse.json([{ code: "EUR-USD" }])),
      http.get(`${BASE}/exchanges/EUR-USD`, () => HttpResponse.json({ code: "EUR-USD" })),
      http.post(`${BASE}/exchanges`, async ({ request }) => {
        created = await request.json();
        return HttpResponse.json({ code: "EUR-USD" }, { status: 201 });
      }),
      http.put(`${BASE}/exchanges/EUR-USD`, () => HttpResponse.json({ code: "EUR-USD" })),
      http.delete(`${BASE}/exchanges/EUR-USD`, () => new HttpResponse(null, { status: 204 })),
    );
    await expect(svc().listExchangeRates()).resolves.toBeDefined();
    expect((await svc().getExchangeRate("EUR-USD")) as { code?: string }).toEqual({ code: "EUR-USD" });
    await svc().createExchangeRate({ code: "EUR-USD", rate: 1.1 } as never);
    expect(created).toEqual({ code: "EUR-USD", rate: 1.1 });
    await expect(svc().updateExchangeRate("EUR-USD", { rate: 1.2 } as never)).resolves.toBeDefined();
    await expect(svc().deleteExchangeRate("EUR-USD")).resolves.toBeUndefined();
  });

  it("encodeURIComponent-escapes the currency code", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/currency/acme/currencies/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({});
      }),
    );
    await svc().getCurrency("a/b");
    expect(pathname).toBe("/currency/acme/currencies/a%2Fb");
  });
});
