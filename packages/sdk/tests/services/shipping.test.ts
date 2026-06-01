import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { ShippingService } from "../../src/services/shipping";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "shipping" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new ShippingService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/shipping/acme";

describe("ShippingService — sites & zones", () => {
  it("findSites POSTs /findSite with a service token", async () => {
    let seenAuth: string | null = null;
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/findSite`, async ({ request }) => {
        seenAuth = request.headers.get("authorization");
        body = await request.json();
        return HttpResponse.json([{ code: "main" }]);
      }),
    );
    await svc().findSites({ postalCode: "10115" } as never);
    expect(seenAuth).toBe("Bearer svc-tok");
    expect(body).toEqual({ postalCode: "10115" });
  });

  it("listZones / getZone use the site-scoped path", async () => {
    let pathname = "";
    server.use(
      http.get(`${BASE}/main/zones`, () => HttpResponse.json([{ id: "z1" }])),
      http.get(`${BASE}/main/zones/z1`, ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({ id: "z1" });
      }),
    );
    await svc().listZones("main");
    await svc().getZone("main", "z1");
    expect(pathname).toBe("/shipping/acme/main/zones/z1");
  });

  it("createZone POSTs and returns the resource location", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/main/zones`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "z1" }, { status: 201 });
      }),
    );
    const res = await svc().createZone("main", { name: "DE" } as never);
    expect(body).toEqual({ name: "DE" });
    expect((res as { id?: string }).id).toBe("z1");
  });

  it("updateZone / patchZone / deleteZone resolve to void", async () => {
    server.use(
      http.put(`${BASE}/main/zones/z1`, () => new HttpResponse(null, { status: 204 })),
      http.patch(`${BASE}/main/zones/z1`, () => new HttpResponse(null, { status: 204 })),
      http.delete(`${BASE}/main/zones/z1`, () => new HttpResponse(null, { status: 204 })),
    );
    await expect(svc().updateZone("main", "z1", { name: "DE" } as never)).resolves.toBeUndefined();
    await expect(svc().patchZone("main", "z1", { name: "DE2" } as never)).resolves.toBeUndefined();
    await expect(svc().deleteZone("main", "z1")).resolves.toBeUndefined();
  });

  it("getZone throws EmporixNotFoundError on 404", async () => {
    server.use(http.get(`${BASE}/main/zones/NOPE`, () => HttpResponse.json({ status: 404, message: "x" }, { status: 404 })));
    await expect(svc().getZone("main", "NOPE")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });
});

describe("ShippingService — methods & quote", () => {
  it("methods CRUD use the nested path", async () => {
    let createdBody: unknown = null;
    let pathname = "";
    server.use(
      http.get(`${BASE}/main/zones/z1/methods`, () => HttpResponse.json([{ id: "m1" }])),
      http.get(`${BASE}/main/zones/z1/methods/m1`, ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({ id: "m1" });
      }),
      http.post(`${BASE}/main/zones/z1/methods`, async ({ request }) => {
        createdBody = await request.json();
        return HttpResponse.json({ id: "m1" }, { status: 201 });
      }),
      http.put(`${BASE}/main/zones/z1/methods/m1`, () => new HttpResponse(null, { status: 204 })),
      http.patch(`${BASE}/main/zones/z1/methods/m1`, () => new HttpResponse(null, { status: 204 })),
      http.delete(`${BASE}/main/zones/z1/methods/m1`, () => new HttpResponse(null, { status: 204 })),
    );
    await svc().listMethods("main", "z1");
    await svc().getMethod("main", "z1", "m1");
    expect(pathname).toBe("/shipping/acme/main/zones/z1/methods/m1");
    await svc().createMethod("main", "z1", { name: "Standard" } as never);
    expect(createdBody).toEqual({ name: "Standard" });
    await expect(svc().updateMethod("main", "z1", "m1", { name: "Std" } as never)).resolves.toBeUndefined();
    await expect(svc().patchMethod("main", "z1", "m1", { name: "Std2" } as never)).resolves.toBeUndefined();
    await expect(svc().deleteMethod("main", "z1", "m1")).resolves.toBeUndefined();
  });

  it("quote / quoteMinimum / quoteSlot POST to their paths", async () => {
    server.use(
      http.post(`${BASE}/main/quote`, () => HttpResponse.json([{ methodId: "m1" }])),
      http.post(`${BASE}/main/quote/minimum`, () => HttpResponse.json({ amount: 5 })),
      http.post(`${BASE}/main/quote/slot`, () => HttpResponse.json({ amount: 7 })),
    );
    await expect(svc().quote("main", { cartId: "c1" } as never)).resolves.toBeDefined();
    await expect(svc().quoteMinimum("main", { cartId: "c1" } as never)).resolves.toBeDefined();
    await expect(svc().quoteSlot("main", { cartId: "c1" } as never)).resolves.toBeDefined();
  });
});

describe("ShippingService — groups & cg-relations", () => {
  it("groups CRUD", async () => {
    let createdBody: unknown = null;
    server.use(
      http.get(`${BASE}/main/groups`, () => HttpResponse.json([{ id: "g1" }])),
      http.get(`${BASE}/main/groups/g1`, () => HttpResponse.json({ id: "g1" })),
      http.post(`${BASE}/main/groups`, async ({ request }) => {
        createdBody = await request.json();
        return HttpResponse.json({ id: "g1" }, { status: 201 });
      }),
      http.put(`${BASE}/main/groups/g1`, () => new HttpResponse(null, { status: 204 })),
      http.delete(`${BASE}/main/groups/g1`, () => new HttpResponse(null, { status: 204 })),
    );
    await svc().listGroups("main");
    expect((await svc().getGroup("main", "g1")) as { id?: string }).toEqual({ id: "g1" });
    await svc().createGroup("main", { name: "Bulky" } as never);
    expect(createdBody).toEqual({ name: "Bulky" });
    await expect(svc().updateGroup("main", "g1", { name: "Bulky2" } as never)).resolves.toBeUndefined();
    await expect(svc().deleteGroup("main", "g1")).resolves.toBeUndefined();
  });

  it("customer-group relations CRUD", async () => {
    let createdBody: unknown = null;
    let pathname = "";
    server.use(
      http.get(`${BASE}/main/cgrelations`, () => HttpResponse.json([{ customerId: "C1" }])),
      http.get(`${BASE}/main/cgrelations/C1`, ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({ customerId: "C1" });
      }),
      http.post(`${BASE}/main/cgrelations`, async ({ request }) => {
        createdBody = await request.json();
        return HttpResponse.json({ customerId: "C1" }, { status: 201 });
      }),
      http.put(`${BASE}/main/cgrelations/C1`, () => new HttpResponse(null, { status: 204 })),
      http.delete(`${BASE}/main/cgrelations/C1`, () => new HttpResponse(null, { status: 204 })),
    );
    await svc().listCgRelations("main");
    await svc().getCgRelations("main", "C1");
    expect(pathname).toBe("/shipping/acme/main/cgrelations/C1");
    await svc().createCgRelation("main", { customerId: "C1" } as never);
    expect(createdBody).toEqual({ customerId: "C1" });
    await expect(svc().updateCgRelations("main", "C1", { groups: [] } as never)).resolves.toBeUndefined();
    await expect(svc().deleteCgRelation("main", "C1")).resolves.toBeUndefined();
  });
});
