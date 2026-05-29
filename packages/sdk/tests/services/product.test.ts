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

  it("list() returns PaginatedItems with hasNextPage=true when page is full", async () => {
    const page = await svc().list({ pageNumber: 1, pageSize: 2 });
    expect(page).toEqual({
      items: [{ id: "p1" }, { id: "p2" }],
      pageNumber: 1,
      pageSize: 2,
      hasNextPage: true,
    });
  });

  it("list() returns hasNextPage=false on a short page", async () => {
    const page = await svc().list({ pageNumber: 2, pageSize: 2 });
    expect(page.items).toEqual([{ id: "p3" }]);
    expect(page.hasNextPage).toBe(false);
    expect(page.pageNumber).toBe(2);
    expect(page.pageSize).toBe(2);
  });

  it("list() defaults to pageNumber=1, pageSize=50", async () => {
    let seen: URLSearchParams | null = null;
    server.use(
      http.get("https://api.emporix.io/product/acme/products", ({ request }) => {
        seen = new URL(request.url).searchParams;
        return HttpResponse.json([]);
      }),
    );
    await svc().list();
    expect((seen as URLSearchParams | null)?.get("pageNumber")).toBe("1");
    expect((seen as URLSearchParams | null)?.get("pageSize")).toBe("50");
  });

  it("search() returns PaginatedItems with hasNextPage", async () => {
    let seen: URLSearchParams | null = null;
    server.use(
      http.get("https://api.emporix.io/product/acme/products", ({ request }) => {
        seen = new URL(request.url).searchParams;
        return HttpResponse.json([{ id: "p1" }, { id: "p2" }]);
      }),
    );
    const page = await svc().search("name:Foo", { pageNumber: 2, pageSize: 2 });
    expect(page).toEqual({
      items: [{ id: "p1" }, { id: "p2" }],
      pageNumber: 2,
      pageSize: 2,
      hasNextPage: true,
    });
    expect((seen as URLSearchParams | null)?.get("q")).toBe("name:Foo");
    expect((seen as URLSearchParams | null)?.get("pageNumber")).toBe("2");
    expect((seen as URLSearchParams | null)?.get("pageSize")).toBe("2");
  });

  it("listAll() yields every item across pages", async () => {
    const ids: string[] = [];
    for await (const p of svc().listAll({ pageSize: 2 })) ids.push(p.id as string);
    expect(ids).toEqual(["p1", "p2", "p3"]);
  });

  it("returns all wire fields, including ones the old facade dropped", async () => {
    server.use(
      http.get("https://api.emporix.io/product/acme/products/p1", () =>
        HttpResponse.json({
          id: "p1",
          code: "C1",
          name: { en: "Widget" },
          mixins: { custom: { warranty: "2y" } },
          media: [{ id: "m1", url: "http://x/i.jpg" }],
        }),
      ),
    );
    const p = await svc().get("p1");
    expect(p.id).toBe("p1");
    expect((p as { mixins?: { custom?: unknown } }).mixins?.custom).toEqual({
      warranty: "2y",
    });
  });

  it("searchByIds POSTs /products/search with q=id:(…) and returns the array", async () => {
    let seenBody: { q?: string } | null = null;
    server.use(
      http.post("https://api.emporix.io/product/acme/products/search", async ({ request }) => {
        seenBody = (await request.json()) as { q?: string };
        return HttpResponse.json([{ id: "p1" }, { id: "p2" }]);
      }),
    );
    const products = await svc().searchByIds(["p1", "p2"]);
    expect((seenBody as { q?: string } | null)?.q).toBe("id:(p1,p2)");
    expect(products.map((p) => p.id as string)).toEqual(["p1", "p2"]);
  });

  it("searchByIds chunks ids according to chunkSize and concatenates results", async () => {
    const calls: string[] = [];
    server.use(
      http.post("https://api.emporix.io/product/acme/products/search", async ({ request }) => {
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
    const products = await svc().searchByIds(["a", "b", "c", "d", "e"], { chunkSize: 2 });
    expect(calls).toEqual(["id:(a,b)", "id:(c,d)", "id:(e)"]);
    expect(products.map((p) => p.id as string).sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("searchByIds short-circuits on an empty id list (no HTTP call)", async () => {
    let hit = false;
    server.use(
      http.post("https://api.emporix.io/product/acme/products/search", () => {
        hit = true;
        return HttpResponse.json([]);
      }),
    );
    expect(await svc().searchByIds([])).toEqual([]);
    expect(hit).toBe(false);
  });
});

describe("ProductService.listVariantChildren", () => {
  it("resolves a parent with 3 children into a flat array", async () => {
    let seenQ: string | null = null;
    server.use(
      http.get("https://api.emporix.io/product/acme/products", ({ request }) => {
        seenQ = new URL(request.url).searchParams.get("q");
        return HttpResponse.json([{ id: "v1" }, { id: "v2" }, { id: "v3" }]);
      }),
    );
    const children = await svc().listVariantChildren("parent-1");
    expect(seenQ).toBe("productType:VARIANT parentVariantId:parent-1");
    expect(children.map((p) => p.id as string)).toEqual(["v1", "v2", "v3"]);
  });

  it("aggregates 250 children across 2 pages (default pageSize 200)", async () => {
    let calls = 0;
    server.use(
      http.get("https://api.emporix.io/product/acme/products", ({ request }) => {
        calls += 1;
        const u = new URL(request.url);
        const page = Number(u.searchParams.get("pageNumber") ?? "1");
        const size = Number(u.searchParams.get("pageSize") ?? "0");
        const count = page === 1 ? size : 50; // page 1 full (200), page 2 short (50)
        const start = (page - 1) * size;
        return HttpResponse.json(
          Array.from({ length: count }, (_, i) => ({ id: `v${start + i}` })),
        );
      }),
    );
    const children = await svc().listVariantChildren("parent-1");
    expect(children).toHaveLength(250);
    expect(calls).toBe(2);
  });

  it("returns an empty array (no throw) when the parent has no children", async () => {
    server.use(
      http.get("https://api.emporix.io/product/acme/products", () => HttpResponse.json([])),
    );
    await expect(svc().listVariantChildren("parent-empty")).resolves.toEqual([]);
  });

  it("encodes a parentVariantId with spaces and special characters", async () => {
    let seenQ: string | null = null;
    server.use(
      http.get("https://api.emporix.io/product/acme/products", ({ request }) => {
        seenQ = new URL(request.url).searchParams.get("q");
        return HttpResponse.json([]);
      }),
    );
    await svc().listVariantChildren("p 1&x");
    // searchParams.get decodes the value — proves the space and & were encoded
    // (otherwise the & would split the query string and truncate q).
    expect(seenQ).toBe("productType:VARIANT parentVariantId:p 1&x");
  });

  it("listVariantChildrenAll streams children across pages", async () => {
    server.use(
      http.get("https://api.emporix.io/product/acme/products", ({ request }) => {
        const u = new URL(request.url);
        const page = Number(u.searchParams.get("pageNumber") ?? "1");
        const size = Number(u.searchParams.get("pageSize") ?? "0");
        const count = page === 1 ? size : 1;
        const start = (page - 1) * size;
        return HttpResponse.json(
          Array.from({ length: count }, (_, i) => ({ id: `v${start + i}` })),
        );
      }),
    );
    const ids: string[] = [];
    for await (const child of svc().listVariantChildrenAll("parent-1", { pageSize: 2 })) {
      ids.push(child.id as string);
    }
    expect(ids).toEqual(["v0", "v1", "v2"]); // page 1: v0,v1 (full) → page 2: v2 (short)
  });
});
