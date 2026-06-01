import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { UnitHandlingService } from "../../src/services/unit-handling";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "unit-handling" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new UnitHandlingService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/unit-handling/acme";

describe("UnitHandlingService", () => {
  it("listUnits GETs with a service token", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(`${BASE}/units`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json([{ code: "KG" }]);
      }),
    );
    await svc().listUnits();
    expect(seenAuth).toBe("Bearer svc-tok");
  });

  it("getUnit / createUnit / updateUnit / deleteUnit", async () => {
    let createBody: unknown = null;
    server.use(
      http.get(`${BASE}/units/KG`, () => HttpResponse.json({ code: "KG" })),
      http.post(`${BASE}/units`, async ({ request }) => {
        createBody = await request.json();
        return HttpResponse.json({ code: "KG" }, { status: 201 });
      }),
      http.put(`${BASE}/units/KG`, () => new HttpResponse(null, { status: 204 })),
      http.delete(`${BASE}/units/KG`, () => new HttpResponse(null, { status: 204 })),
    );
    expect((await svc().getUnit("KG")) as { code?: string }).toEqual({ code: "KG" });
    await svc().createUnit({ code: "KG", name: "Kilogram" } as never);
    expect(createBody).toEqual({ code: "KG", name: "Kilogram" });
    await expect(svc().updateUnit("KG", { name: "Kilo" } as never)).resolves.toBeUndefined();
    await expect(svc().deleteUnit("KG")).resolves.toBeUndefined();
  });

  it("deleteUnits sends the codes array as the body", async () => {
    let body: unknown = null;
    server.use(
      http.delete(`${BASE}/units`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(svc().deleteUnits(["KG", "G"])).resolves.toBeUndefined();
    expect(body).toEqual(["KG", "G"]);
  });

  it("getUnit throws EmporixNotFoundError on 404", async () => {
    server.use(http.get(`${BASE}/units/NOPE`, () => HttpResponse.json({ status: 404, message: "x" }, { status: 404 })));
    await expect(svc().getUnit("NOPE")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("getConversionFactor / convertUnit PUT the command and return the result", async () => {
    let factorBody: unknown = null;
    server.use(
      http.put(`${BASE}/units/conversion-factor-commands`, async ({ request }) => {
        factorBody = await request.json();
        return HttpResponse.json({ factor: 1000 }, { status: 201 });
      }),
      http.put(`${BASE}/units/convert-unit-commands`, () => HttpResponse.json({ value: 5 }, { status: 201 })),
    );
    await expect(svc().getConversionFactor({ from: "KG", to: "G" } as never)).resolves.toBeDefined();
    expect(factorBody).toEqual({ from: "KG", to: "G" });
    await expect(svc().convertUnit({ from: "KG", to: "G", value: 5 } as never)).resolves.toBeDefined();
  });

  it("listUnitTypes GETs the types array", async () => {
    server.use(http.get(`${BASE}/types`, () => HttpResponse.json(["WEIGHT", "VOLUME"])));
    expect(await svc().listUnitTypes()).toEqual(["WEIGHT", "VOLUME"]);
  });

  it("encodeURIComponent-escapes the unit code", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/unit-handling/acme/units/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({});
      }),
    );
    await svc().getUnit("a/b");
    expect(pathname).toBe("/unit-handling/acme/units/a%2Fb");
  });
});
