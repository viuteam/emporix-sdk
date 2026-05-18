import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { CategoryService } from "../../src/services/category";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
  http.get("https://api.emporix.io/category/acme/categories/c1", () =>
    HttpResponse.json({ id: "c1", name: "Books" }),
  ),
  http.get("https://api.emporix.io/category/acme/categories/tree", ({ request }) => {
    const u = new URL(request.url);
    return HttpResponse.json({ id: u.searchParams.get("rootId") ?? "root", children: [] });
  }),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function svc() {
  const cfg = {
    tenant: "acme", host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "category" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io", provider: tokenProvider, logger,
    retry: { maxAttempts: 1 }, timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new CategoryService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

describe("CategoryService", () => {
  it("get() returns a category", async () => {
    expect((await svc().get("c1")).name).toBe("Books");
  });
  it("tree() passes rootId when provided", async () => {
    expect((await svc().tree("root-7")).id).toBe("root-7");
  });
  it("returns generated category fields the old facade dropped", async () => {
    server.use(
      http.get("https://api.emporix.io/category/acme/categories/c1", () =>
        HttpResponse.json({ id: "c1", localizedName: { en: "Shoes" }, published: true }),
      ),
    );
    const cat = await svc().get("c1");
    expect(cat.id).toBe("c1");
    expect((cat as { published?: boolean }).published).toBe(true);
  });
});
