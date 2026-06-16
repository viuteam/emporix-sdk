import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { VendorService } from "../../src/services/vendor";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "vendor" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new VendorService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/vendor/acme";

describe("VendorService — vendors", () => {
  it("listVendors GETs with a service token", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(`${BASE}/vendors`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json([{ id: "v1" }]);
      }),
    );
    await svc().listVendors();
    expect(seenAuth).toBe("Bearer svc-tok");
  });

  it("get / create / update / delete", async () => {
    let createBody: unknown = null;
    server.use(
      http.get(`${BASE}/vendors/v1`, () => HttpResponse.json({ id: "v1" })),
      http.post(`${BASE}/vendors`, async ({ request }) => {
        createBody = await request.json();
        return HttpResponse.json({ id: "v1" }, { status: 201 });
      }),
      http.put(`${BASE}/vendors/v1`, () => new HttpResponse(null, { status: 204 })),
      http.delete(`${BASE}/vendors/v1`, () => new HttpResponse(null, { status: 204 })),
    );
    expect((await svc().getVendor("v1")) as { id?: string }).toEqual({ id: "v1" });
    expect((await svc().createVendor({ name: "Acme" } as never) as { id?: string }).id).toBe("v1");
    expect(createBody).toEqual({ name: "Acme" });
    await expect(svc().updateVendor("v1", { name: "Acme2" } as never)).resolves.toBeUndefined();
    await expect(svc().deleteVendor("v1")).resolves.toBeUndefined();
  });

  it("searchVendors POSTs to /vendors/search", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/vendors/search`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json([{ id: "v1" }]);
      }),
    );
    await svc().searchVendors({ name: "Acme" });
    expect(body).toEqual({ name: "Acme" });
  });

  it("getVendor throws EmporixNotFoundError on 404", async () => {
    server.use(http.get(`${BASE}/vendors/NOPE`, () => HttpResponse.json({ status: 404, message: "x" }, { status: 404 })));
    await expect(svc().getVendor("NOPE")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("encodeURIComponent-escapes the vendor id", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/vendor/acme/vendors/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({});
      }),
    );
    await svc().getVendor("a/b");
    expect(pathname).toBe("/vendor/acme/vendors/a%2Fb");
  });
});

describe("VendorService — locations", () => {
  it("location CRUD", async () => {
    let createBody: unknown = null;
    server.use(
      http.get(`${BASE}/locations`, () => HttpResponse.json([{ id: "l1" }])),
      http.get(`${BASE}/locations/l1`, () => HttpResponse.json({ id: "l1" })),
      http.post(`${BASE}/locations`, async ({ request }) => {
        createBody = await request.json();
        return HttpResponse.json({ id: "l1" }, { status: 201 });
      }),
      http.put(`${BASE}/locations/l1`, () => new HttpResponse(null, { status: 204 })),
      http.delete(`${BASE}/locations/l1`, () => new HttpResponse(null, { status: 204 })),
    );
    await svc().listVendorLocations();
    expect((await svc().getVendorLocation("l1")) as { id?: string }).toEqual({ id: "l1" });
    await svc().createVendorLocation({ name: "Berlin" } as never);
    expect(createBody).toEqual({ name: "Berlin" });
    await expect(svc().updateVendorLocation("l1", { name: "Berlin2" } as never)).resolves.toBeUndefined();
    await expect(svc().deleteVendorLocation("l1")).resolves.toBeUndefined();
  });
});

describe("VendorService.searchVendors — q filter", () => {
  it("resolves a built filter in the body's q field", async () => {
    let seenBody: { q?: unknown } | null = null;
    server.use(
      http.post(`${BASE}/vendors/search`, async ({ request }) => {
        seenBody = (await request.json()) as { q?: unknown };
        return HttpResponse.json([{ id: "v-1" }]);
      }),
    );
    await svc().searchVendors({
      q: { toString: () => "mixins.vendorAttrs.region:EU", usesCompound: false },
    });
    expect((seenBody as { q?: unknown } | null)?.q).toBe("mixins.vendorAttrs.region:EU");
  });

  it("passes a raw string q through unchanged", async () => {
    let seenBody: { q?: unknown } | null = null;
    server.use(
      http.post(`${BASE}/vendors/search`, async ({ request }) => {
        seenBody = (await request.json()) as { q?: unknown };
        return HttpResponse.json([]);
      }),
    );
    await svc().searchVendors({ q: "name:Acme" });
    expect((seenBody as { q?: unknown } | null)?.q).toBe("name:Acme");
  });
});
