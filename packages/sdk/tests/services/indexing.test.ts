import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { IndexingService } from "../../src/services/indexing";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "indexing" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new IndexingService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/indexing/acme";

describe("IndexingService", () => {
  it("listConfigurations GETs with a service token", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(`${BASE}/configurations`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json([{ provider: "algolia" }]);
      }),
    );
    await svc().listConfigurations();
    expect(seenAuth).toBe("Bearer svc-tok");
  });

  it("getConfiguration / create / update / delete", async () => {
    let createBody: unknown = null;
    server.use(
      http.get(`${BASE}/configurations/algolia`, () => HttpResponse.json({ provider: "algolia" })),
      http.post(`${BASE}/configurations`, async ({ request }) => {
        createBody = await request.json();
        return HttpResponse.json({ provider: "algolia" }, { status: 201 });
      }),
      http.put(`${BASE}/configurations/algolia`, () => new HttpResponse(null, { status: 204 })),
      http.delete(`${BASE}/configurations/algolia`, () => new HttpResponse(null, { status: 204 })),
    );
    expect((await svc().getConfiguration("algolia")) as { provider?: string }).toEqual({ provider: "algolia" });
    await svc().createConfiguration({ provider: "algolia" } as never);
    expect(createBody).toEqual({ provider: "algolia" });
    await expect(svc().updateConfiguration("algolia", { provider: "algolia" } as never)).resolves.toBeUndefined();
    await expect(svc().deleteConfiguration("algolia")).resolves.toBeUndefined();
  });

  it("getConfiguration throws EmporixNotFoundError on 404", async () => {
    server.use(http.get(`${BASE}/configurations/NOPE`, () => HttpResponse.json({ status: 404, message: "x" }, { status: 404 })));
    await expect(svc().getConfiguration("NOPE")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("public configurations: list + get", async () => {
    server.use(
      http.get(`${BASE}/public/configurations`, () => HttpResponse.json([{ provider: "algolia" }])),
      http.get(`${BASE}/public/configurations/algolia`, () => HttpResponse.json({ provider: "algolia" })),
    );
    await expect(svc().listPublicConfigurations()).resolves.toBeDefined();
    expect((await svc().getPublicConfiguration("algolia")) as { provider?: string }).toEqual({ provider: "algolia" });
  });

  it("reindex POSTs and resolves to void", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/reindex`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(svc().reindex({ provider: "algolia" } as never)).resolves.toBeUndefined();
    expect(body).toEqual({ provider: "algolia" });
  });

  it("encodeURIComponent-escapes the provider", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/indexing/acme/configurations/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({});
      }),
    );
    await svc().getConfiguration("a/b");
    expect(pathname).toBe("/indexing/acme/configurations/a%2Fb");
  });
});
