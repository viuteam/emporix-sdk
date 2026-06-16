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
  http.get("https://api.emporix.io/category/acme/category-trees", () =>
    HttpResponse.json([{ id: "t1", name: "Sport" }, { id: "t2", name: "Wellness" }]),
  ),
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
  it("tree() returns the catalogue's root categories", async () => {
    const roots = await svc().tree();
    expect(roots.map((c) => c.id)).toEqual(["t1", "t2"]);
  });
  it("subcategories() resolves CATEGORY assignments to child categories", async () => {
    let searchBody: unknown = null;
    server.use(
      http.get("https://api.emporix.io/category/acme/categories/c1/assignments", () =>
        HttpResponse.json([
          { ref: { id: "sub1", type: "CATEGORY", url: "…" } },
          { ref: { id: "p9", type: "PRODUCT", url: "…" } }, // product ref ignored
          { ref: { id: "sub2", type: "category", url: "…" } }, // lowercase tolerated
        ]),
      ),
      http.post("https://api.emporix.io/category/acme/categories/search", async ({ request }) => {
        searchBody = await request.json();
        return HttpResponse.json([{ id: "sub1", name: "Shirts" }, { id: "sub2", name: "Trousers" }]);
      }),
    );
    const subs = await svc().subcategories("c1", { pageSize: 50 });
    expect(subs.map((s) => s.id)).toEqual(["sub1", "sub2"]);
    expect(searchBody).toEqual({ q: "id:(sub1,sub2)" });
  });
  it("subcategories() returns [] when a category has no child categories", async () => {
    server.use(
      http.get("https://api.emporix.io/category/acme/categories/c1/assignments", () =>
        HttpResponse.json([{ ref: { id: "p1", type: "PRODUCT", url: "…" } }]),
      ),
    );
    expect(await svc().subcategories("c1")).toEqual([]);
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

  it("list() returns PaginatedItems<Category> with hasNextPage", async () => {
    server.use(
      http.get("https://api.emporix.io/category/acme/categories", ({ request }) => {
        const u = new URL(request.url);
        const page = Number(u.searchParams.get("pageNumber") ?? "1");
        const items = page === 1 ? [{ id: "c1" }, { id: "c2" }] : [{ id: "c3" }];
        return HttpResponse.json(items);
      }),
    );
    const full = await svc().list({ pageNumber: 1, pageSize: 2 });
    expect(full).toEqual({
      items: [{ id: "c1" }, { id: "c2" }],
      pageNumber: 1,
      pageSize: 2,
      hasNextPage: true,
    });
    const short = await svc().list({ pageNumber: 2, pageSize: 2 });
    expect(short.hasNextPage).toBe(false);
    expect(short.items).toEqual([{ id: "c3" }]);
  });

  it("productsIn() resolves category assignments to products", async () => {
    let assignQuery: URLSearchParams | null = null;
    let searchBody: unknown = null;
    server.use(
      // 1. category assignments (references to products + other resources)
      http.get(
        "https://api.emporix.io/category/acme/categories/c1/assignments",
        ({ request }) => {
          assignQuery = new URL(request.url).searchParams;
          return HttpResponse.json([
            { id: "a1", ref: { id: "p1", type: "PRODUCT", url: "…" } },
            { id: "a2", ref: { id: "cat-sub", type: "CATEGORY", url: "…" } },
            { id: "a3", ref: { id: "p2", type: "PRODUCT", url: "…" } },
          ]);
        },
      ),
      // 2. resolve the PRODUCT references to full products
      http.post("https://api.emporix.io/product/acme/products/search", async ({ request }) => {
        searchBody = await request.json();
        return HttpResponse.json([{ id: "p1" }, { id: "p2" }]);
      }),
    );
    const page = await svc().productsIn("c1", { pageNumber: 1, pageSize: 3 });
    expect(page).toEqual({
      items: [{ id: "p1" }, { id: "p2" }],
      pageNumber: 1,
      pageSize: 3,
      hasNextPage: true, // assignments page was full (length === pageSize)
    });
    // assignments paged with the caller's params
    expect((assignQuery as URLSearchParams | null)?.get("pageNumber")).toBe("1");
    expect((assignQuery as URLSearchParams | null)?.get("pageSize")).toBe("3");
    // only PRODUCT refs resolved; CATEGORY ref skipped
    expect(searchBody).toEqual({ q: "id:(p1,p2)" });
  });

  it("productsIn() returns an empty page when a category has no product assignments", async () => {
    server.use(
      http.get("https://api.emporix.io/category/acme/categories/c1/assignments", () =>
        HttpResponse.json([{ id: "a2", ref: { id: "cat-sub", type: "CATEGORY", url: "…" } }]),
      ),
    );
    const page = await svc().productsIn("c1", { pageNumber: 1, pageSize: 24 });
    expect(page.items).toEqual([]);
    expect(page.hasNextPage).toBe(false);
  });

  it("listAll() iterates categories across pages", async () => {
    server.use(
      http.get("https://api.emporix.io/category/acme/categories", ({ request }) => {
        const u = new URL(request.url);
        const page = Number(u.searchParams.get("pageNumber") ?? "1");
        const items = page === 1 ? [{ id: "c1" }, { id: "c2" }] : [{ id: "c3" }];
        return HttpResponse.json(items);
      }),
    );
    const ids: string[] = [];
    for await (const c of svc().listAll({ pageSize: 2 })) ids.push(c.id as string);
    expect(ids).toEqual(["c1", "c2", "c3"]);
  });
});

describe("CategoryService.search", () => {
  it("sends q + pagination and wraps the array into PaginatedItems", async () => {
    let seen: URLSearchParams | null = null;
    server.use(
      http.get("https://api.emporix.io/category/acme/categories", ({ request }) => {
        seen = new URL(request.url).searchParams;
        return HttpResponse.json([{ id: "c1" }, { id: "c2" }]);
      }),
    );
    const page = await svc().search("mixins.attrs.featured:true", { pageNumber: 2, pageSize: 2 });
    expect(page.items.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(page.hasNextPage).toBe(true);
    expect((seen as URLSearchParams | null)?.get("q")).toBe("mixins.attrs.featured:true");
    expect((seen as URLSearchParams | null)?.get("pageNumber")).toBe("2");
  });

  it("accepts a built filter (toString) and rejects an or() filter (Category is non-compound)", async () => {
    let seen: URLSearchParams | null = null;
    server.use(
      http.get("https://api.emporix.io/category/acme/categories", ({ request }) => {
        seen = new URL(request.url).searchParams;
        return HttpResponse.json([{ id: "c1" }]);
      }),
    );
    await svc().search({ toString: () => "mixins.attrs.featured:true", usesCompound: false });
    expect((seen as URLSearchParams | null)?.get("q")).toBe("mixins.attrs.featured:true");
    await expect(
      svc().search({ toString: () => "compoundLogicalQuery:((a) OR (b))", usesCompound: true }),
    ).rejects.toThrow(/does not support/i);
  });
});
