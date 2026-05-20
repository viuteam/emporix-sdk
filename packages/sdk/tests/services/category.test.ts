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

  it("searchByIds POSTs /categories/search with q=id:(…) and returns the array", async () => {
    let seenBody: { q?: string } | null = null;
    server.use(
      http.post("https://api.emporix.io/category/acme/categories/search", async ({ request }) => {
        seenBody = (await request.json()) as { q?: string };
        return HttpResponse.json([{ id: "c1" }, { id: "c2" }]);
      }),
    );
    const cats = await svc().searchByIds(["c1", "c2"]);
    expect((seenBody as { q?: string } | null)?.q).toBe("id:(c1,c2)");
    expect(cats.map((c) => c.id as string)).toEqual(["c1", "c2"]);
  });

  it("searchByIds chunks ids and concatenates", async () => {
    const calls: string[] = [];
    server.use(
      http.post("https://api.emporix.io/category/acme/categories/search", async ({ request }) => {
        const body = (await request.json()) as { q?: string };
        calls.push(body.q ?? "");
        const ids = (body.q ?? "")
          .replace(/^id:\(/, "")
          .replace(/\)$/, "")
          .split(",")
          .filter(Boolean);
        return HttpResponse.json(ids.map((id) => ({ id })));
      }),
    );
    const cats = await svc().searchByIds(["a", "b", "c"], { chunkSize: 2 });
    expect(calls).toEqual(["id:(a,b)", "id:(c)"]);
    expect(cats.map((c) => c.id as string).sort()).toEqual(["a", "b", "c"]);
  });

  it("searchByIds short-circuits on an empty id list", async () => {
    let hit = false;
    server.use(
      http.post("https://api.emporix.io/category/acme/categories/search", () => {
        hit = true;
        return HttpResponse.json([]);
      }),
    );
    expect(await svc().searchByIds([])).toEqual([]);
    expect(hit).toBe(false);
  });
});
