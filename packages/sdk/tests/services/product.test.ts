import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { ProductService } from "../../src/services/product";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";

let seenAuth: string[] = [];
const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
  http.get("https://api.emporix.io/product/acme/products/p1", ({ request }) => {
    seenAuth.push(request.headers.get("authorization") ?? "");
    return HttpResponse.json({ id: "p1", name: "Widget" });
  }),
  http.get("https://api.emporix.io/product/acme/products", ({ request }) => {
    const u = new URL(request.url);
    const page = Number(u.searchParams.get("pageNumber") ?? "1");
    const items = page === 1 ? [{ id: "p1" }, { id: "p2" }] : [{ id: "p3" }];
    return HttpResponse.json(items, { headers: { "X-Total-Count": "3" } });
  }),
);
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  seenAuth = [];
});
afterAll(() => server.close());

function svc() {
  const cfg = {
    tenant: "acme", host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "product" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io", provider: tokenProvider, logger,
    retry: { maxAttempts: 1 }, timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new ProductService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

describe("ProductService", () => {
  it("get() defaults to anonymous auth", async () => {
    const p = await svc().get("p1");
    expect(p.id).toBe("p1");
    expect(seenAuth[0]).toBe("Bearer anon");
  });

  it("get() honours a customer context for personalized reads", async () => {
    await svc().get("p1", undefined, { kind: "customer", token: "CUST" });
    expect(seenAuth[0]).toBe("Bearer CUST");
  });

  it("listAll() yields every item across pages", async () => {
    const ids: string[] = [];
    for await (const p of svc().listAll({ pageSize: 2 })) ids.push(p.id as string);
    expect(ids).toEqual(["p1", "p2", "p3"]);
  });
});
