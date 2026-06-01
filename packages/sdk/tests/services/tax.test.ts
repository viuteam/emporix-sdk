import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { TaxService } from "../../src/services/tax";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "tax" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new TaxService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/tax/acme";

describe("TaxService", () => {
  it("listTaxConfigs GETs the array with a service token", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(`${BASE}/taxes`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json([{ locationCode: "DE", taxClasses: [] }]);
      }),
    );
    const out = await svc().listTaxConfigs();
    expect(seenAuth).toBe("Bearer svc-tok");
    expect(out).toHaveLength(1);
    expect(out[0]?.locationCode).toBe("DE");
  });

  it("getTaxConfig fetches one by location code", async () => {
    server.use(
      http.get(`${BASE}/taxes/DE`, () =>
        HttpResponse.json({ locationCode: "DE", taxClasses: [{ code: "STD", rate: 19 }] }),
      ),
    );
    const c = await svc().getTaxConfig("DE");
    expect(c.locationCode).toBe("DE");
    expect(c.taxClasses[0]?.code).toBe("STD");
  });

  it("getTaxConfig throws EmporixNotFoundError on 404", async () => {
    server.use(
      http.get(`${BASE}/taxes/XX`, () =>
        HttpResponse.json({ status: 404, message: "not found" }, { status: 404 }),
      ),
    );
    await expect(svc().getTaxConfig("XX")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("createTaxConfig POSTs the input and returns { locationCode }", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/taxes`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ locationCode: "DE" }, { status: 201 });
      }),
    );
    const res = await svc().createTaxConfig({
      location: { countryCode: "DE" },
      taxClasses: [{ code: "STD", name: "Standard", rate: 19 }],
    });
    expect(body).toEqual({
      location: { countryCode: "DE" },
      taxClasses: [{ code: "STD", name: "Standard", rate: 19 }],
    });
    expect(res.locationCode).toBe("DE");
  });

  it("updateTaxConfig PUTs to the location code", async () => {
    let body: unknown = null;
    server.use(
      http.put(`${BASE}/taxes/DE`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ locationCode: "DE", taxClasses: [] });
      }),
    );
    const c = await svc().updateTaxConfig("DE", {
      location: { countryCode: "DE" },
      taxClasses: [],
      metadata: { version: 2 },
    });
    expect((body as { metadata: { version: number } }).metadata.version).toBe(2);
    expect(c?.locationCode).toBe("DE");
  });

  it("deleteTaxConfig DELETEs and resolves to void", async () => {
    server.use(
      http.delete(`${BASE}/taxes/DE`, () => new HttpResponse(null, { status: 204 })),
    );
    await expect(svc().deleteTaxConfig("DE")).resolves.toBeUndefined();
  });

  it("calculateTax PUTs the command and returns the output", async () => {
    let body: unknown = null;
    server.use(
      http.put(`${BASE}/taxes/calculation-commands`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          input: { targetLocation: { countryCode: "DE" }, price: 100 },
          output: { netPrice: 100, grossPrice: 119, targetTaxRate: 19 },
        });
      }),
    );
    const res = await svc().calculateTax({
      input: {
        targetLocation: { countryCode: "DE" },
        targetTaxClass: "STANDARD",
        price: 100,
        includesTax: false,
      },
    });
    expect((body as { input: { price: number } }).input.price).toBe(100);
    expect(res.output?.grossPrice).toBe(119);
  });

  it("encodeURIComponent-escapes the location code in the path", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/tax/acme/taxes/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({ locationCode: "a/b", taxClasses: [] });
      }),
    );
    await svc().getTaxConfig("a/b");
    expect(pathname).toBe("/tax/acme/taxes/a%2Fb");
  });
});
