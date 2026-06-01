import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { BrandService } from "../../src/services/brand";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "brand" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new BrandService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/brand/brands";

describe("BrandService", () => {
  it("listBrands GETs the tenant-less path with a service token", async () => {
    let seenAuth: string | null = null;
    let pathname = "";
    server.use(
      http.get(BASE, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        pathname = new URL(request.url).pathname;
        return HttpResponse.json([{ id: "b1" }]);
      }),
    );
    await svc().listBrands();
    expect(seenAuth).toBe("Bearer svc-tok");
    expect(pathname).toBe("/brand/brands");
  });

  it("getBrand fetches one by id", async () => {
    server.use(http.get(`${BASE}/b1`, () => HttpResponse.json({ id: "b1" })));
    expect((await svc().getBrand("b1")) as { id?: string }).toEqual({ id: "b1" });
  });

  it("getBrand throws EmporixNotFoundError on 404", async () => {
    server.use(http.get(`${BASE}/NOPE`, () => HttpResponse.json({ status: 404, message: "x" }, { status: 404 })));
    await expect(svc().getBrand("NOPE")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("createBrand POSTs the body", async () => {
    let body: unknown = null;
    server.use(
      http.post(BASE, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "b1" }, { status: 201 });
      }),
    );
    await svc().createBrand({ name: "Acme" } as never);
    expect(body).toEqual({ name: "Acme" });
  });

  it("updateBrand PUTs to the id", async () => {
    let body: unknown = null;
    server.use(
      http.put(`${BASE}/b1`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "b1" });
      }),
    );
    await svc().updateBrand("b1", { name: "Acme2" } as never);
    expect(body).toEqual({ name: "Acme2" });
  });

  it("patchBrand PATCHes the id", async () => {
    let body: unknown = null;
    server.use(
      http.patch(`${BASE}/b1`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "b1" });
      }),
    );
    await svc().patchBrand("b1", { name: "Renamed" } as never);
    expect(body).toEqual({ name: "Renamed" });
  });

  it("deleteBrand DELETEs and resolves to void", async () => {
    server.use(http.delete(`${BASE}/b1`, () => new HttpResponse(null, { status: 204 })));
    await expect(svc().deleteBrand("b1")).resolves.toBeUndefined();
  });

  it("encodeURIComponent-escapes the brand id", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/brand/brands/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({});
      }),
    );
    await svc().getBrand("a/b");
    expect(pathname).toBe("/brand/brands/a%2Fb");
  });
});
