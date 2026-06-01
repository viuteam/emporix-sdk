import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { RagIndexerService } from "../../src/services/ai-rag-indexer";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "ai-rag-indexer" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new RagIndexerService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/ai-rag-indexer/acme/PRODUCT";

describe("RagIndexerService", () => {
  it("ragMetadata GETs the embedding fields with a service token, default type PRODUCT", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(`${BASE}/rag-metadata`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json(["name", "description", "brand"]);
      }),
    );
    const fields = await svc().ragMetadata();
    expect(seenAuth).toBe("Bearer svc-tok");
    expect(fields).toEqual(["name", "description", "brand"]);
  });

  it("filterMetadata GETs the filterable fields", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(`${BASE}/filter-metadata`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json([
          { key: "price", type: "float" },
          { key: "inStock", type: "boolean" },
        ]);
      }),
    );
    const filters = await svc().filterMetadata();
    expect(seenAuth).toBe("Bearer svc-tok");
    expect(filters.map((f) => f.key)).toEqual(["price", "inStock"]);
    expect(filters[0]?.type).toBe("float");
  });

  it("reindex POSTs with no body and resolves to void on 204", async () => {
    let method = "";
    let bodyText = "init";
    server.use(
      http.post(`${BASE}/reindex`, async ({ request }) => {
        method = request.method;
        bodyText = await request.text();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(svc().reindex()).resolves.toBeUndefined();
    expect(method).toBe("POST");
    expect(bodyText).toBe("");
  });

  it("threads an explicit type through the path", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/ai-rag-indexer/acme/*/rag-metadata", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json([]);
      }),
    );
    // cast: the surface only declares "PRODUCT" today, but the path must honour any type
    await svc().ragMetadata("PRODUCT" as never);
    expect(pathname).toBe("/ai-rag-indexer/acme/PRODUCT/rag-metadata");
  });
});
