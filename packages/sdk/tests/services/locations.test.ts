import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { LocationsService } from "../../src/services/locations";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function harness() {
  const cfg = {
    tenant: "acme",
    host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "customer-management" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new LocationsService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const CUST = { kind: "customer" as const, token: "cust-tok" };

describe("LocationsService", () => {
  it("listForCompany GETs with legalEntityId query param", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.get("https://api.emporix.io/customer-management/acme/locations", ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json([
          { id: "loc-1", name: "HQ", type: "HEADQUARTER" },
          { id: "loc-2", name: "Lager", type: "WAREHOUSE" },
        ]);
      }),
    );
    const rows = await harness().listForCompany("le-1", CUST);
    expect((q as URLSearchParams | null)?.get("legalEntityId")).toBe("le-1");
    expect(rows.map((r) => r.type)).toEqual(["HEADQUARTER", "WAREHOUSE"]);
  });

  it("get fetches one location by id", async () => {
    server.use(
      http.get("https://api.emporix.io/customer-management/acme/locations/loc-1", () =>
        HttpResponse.json({ id: "loc-1", name: "HQ", type: "HEADQUARTER" }),
      ),
    );
    const r = await harness().get("loc-1", CUST);
    expect(r.name).toBe("HQ");
  });

  it("create accepts each location type and POSTs the body", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post("https://api.emporix.io/customer-management/acme/locations", async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ id: "loc-new" }, { status: 201 });
      }),
    );
    for (const type of ["HEADQUARTER", "WAREHOUSE", "OFFICE"] as const) {
      const r = await harness().create(
        { name: type, type, contactDetails: { city: "Zürich" } },
        CUST,
      );
      expect(r.id).toBe("loc-new");
    }
    expect(bodies).toHaveLength(3);
  });

  it("update PATCHes the location", async () => {
    server.use(
      http.patch("https://api.emporix.io/customer-management/acme/locations/loc-1", () =>
        HttpResponse.json({ id: "loc-1", name: "Renamed", type: "HEADQUARTER" }),
      ),
    );
    const r = await harness().update("loc-1", { name: "Renamed" }, CUST);
    expect(r.name).toBe("Renamed");
  });

  it("delete DELETEs and returns void", async () => {
    server.use(
      http.delete("https://api.emporix.io/customer-management/acme/locations/loc-1", () =>
        new HttpResponse(null, { status: 204 }),
      ),
    );
    await expect(harness().delete("loc-1", CUST)).resolves.toBeUndefined();
  });
});
