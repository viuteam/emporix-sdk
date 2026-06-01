import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { CountryService } from "../../src/services/country";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "country" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new CountryService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/country/acme";

describe("CountryService", () => {
  it("listCountries GETs with a service token", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(`${BASE}/countries`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json([{ code: "DE" }]);
      }),
    );
    await svc().listCountries();
    expect(seenAuth).toBe("Bearer svc-tok");
  });

  it("getCountry fetches one by code", async () => {
    server.use(http.get(`${BASE}/countries/DE`, () => HttpResponse.json({ code: "DE" })));
    expect((await svc().getCountry("DE")) as { code?: string }).toEqual({ code: "DE" });
  });

  it("getCountry throws EmporixNotFoundError on 404", async () => {
    server.use(http.get(`${BASE}/countries/XX`, () => HttpResponse.json({ status: 404, message: "x" }, { status: 404 })));
    await expect(svc().getCountry("XX")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("patchCountry PATCHes the code and resolves to void (204)", async () => {
    let body: unknown = null;
    server.use(
      http.patch(`${BASE}/countries/DE`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(svc().patchCountry("DE", { active: true } as never)).resolves.toBeUndefined();
    expect(body).toEqual({ active: true });
  });

  it("listRegions GETs regions", async () => {
    server.use(http.get(`${BASE}/regions`, () => HttpResponse.json([{ code: "DE-BY" }])));
    await expect(svc().listRegions()).resolves.toBeDefined();
  });

  it("getRegion fetches one region", async () => {
    server.use(http.get(`${BASE}/regions/DE-BY`, () => HttpResponse.json({ code: "DE-BY" })));
    expect((await svc().getRegion("DE-BY")) as { code?: string }).toEqual({ code: "DE-BY" });
  });

  it("encodeURIComponent-escapes the country code", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/country/acme/countries/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({});
      }),
    );
    await svc().getCountry("a/b");
    expect(pathname).toBe("/country/acme/countries/a%2Fb");
  });
});
