import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { CatalogService } from "../../src/services/catalog";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "catalog" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new CatalogService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/catalog/acme/catalogs";

describe("CatalogService", () => {
  it("listCatalogs GETs with a service token", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(BASE, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json([{ id: "c1" }]);
      }),
    );
    await svc().listCatalogs();
    expect(seenAuth).toBe("Bearer svc-tok");
  });

  it("getCatalog / getCatalogsForCategory use the right paths", async () => {
    let catPath = "";
    server.use(
      http.get(`${BASE}/c1`, () => HttpResponse.json({ id: "c1" })),
      http.get(`${BASE}/categories/cat1`, ({ request }) => {
        catPath = new URL(request.url).pathname;
        return HttpResponse.json([{ id: "c1" }]);
      }),
    );
    expect((await svc().getCatalog("c1")) as { id?: string }).toEqual({ id: "c1" });
    await svc().getCatalogsForCategory("cat1");
    expect(catPath).toBe("/catalog/acme/catalogs/categories/cat1");
  });

  it("createCatalog / updateCatalog return the created id", async () => {
    let createBody: unknown = null;
    server.use(
      http.post(BASE, async ({ request }) => {
        createBody = await request.json();
        return HttpResponse.json({ id: "c1" }, { status: 201 });
      }),
      http.put(`${BASE}/c1`, () => HttpResponse.json({ id: "c1" }, { status: 201 })),
    );
    expect((await svc().createCatalog({ name: "Main" } as never)).id).toBe("c1");
    expect(createBody).toEqual({ name: "Main" });
    expect((await svc().updateCatalog("c1", { name: "Main2" } as never)).id).toBe("c1");
  });

  it("patchCatalog PATCHes the partial body and resolves to void", async () => {
    let body: unknown = null;
    server.use(
      http.patch(`${BASE}/c1`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(svc().patchCatalog("c1", { name: "Renamed" } as never)).resolves.toBeUndefined();
    expect(body).toEqual({ name: "Renamed" });
  });

  it("deleteCatalog DELETEs and resolves to void", async () => {
    server.use(http.delete(`${BASE}/c1`, () => new HttpResponse(null, { status: 204 })));
    await expect(svc().deleteCatalog("c1")).resolves.toBeUndefined();
  });

  it("getCatalog throws EmporixNotFoundError on 404", async () => {
    server.use(http.get(`${BASE}/NOPE`, () => HttpResponse.json({ status: 404, message: "x" }, { status: 404 })));
    await expect(svc().getCatalog("NOPE")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("encodeURIComponent-escapes the catalog id", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/catalog/acme/catalogs/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({});
      }),
    );
    await svc().getCatalog("a/b");
    expect(pathname).toBe("/catalog/acme/catalogs/a%2Fb");
  });
});
