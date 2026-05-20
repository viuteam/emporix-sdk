import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { SegmentService } from "../../src/services/segment";
import { ProductService } from "../../src/services/product";
import { CategoryService } from "../../src/services/category";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";
import { EmporixAuthError } from "../../src/core/errors";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function harness() {
  const cfg = {
    tenant: "acme",
    host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "segment" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  const ctx = { tenant: "acme", http: httpClient, tokenProvider, logger };
  const products = new ProductService(ctx);
  const categories = new CategoryService(ctx);
  return { svc: new SegmentService(ctx, { products, categories }), products, categories };
}

const CUST = { kind: "customer" as const, token: "cust-tok" };

describe("SegmentService.list / get", () => {
  it("list rejects an anonymous auth context", async () => {
    await expect(harness().svc.list({}, { kind: "anonymous" })).rejects.toBeInstanceOf(
      EmporixAuthError,
    );
  });

  it("list sends the customer Bearer and returns the segments array", async () => {
    let auth: string | null = null;
    server.use(
      http.get("https://api.emporix.io/customer-segment/acme/segments", ({ request }) => {
        auth = request.headers.get("authorization");
        return HttpResponse.json([{ id: "seg-1" }, { id: "seg-2" }]);
      }),
    );
    const rows = await harness().svc.list({}, CUST);
    expect(auth).toBe("Bearer cust-tok");
    expect(rows.map((r) => (r as { id?: string }).id)).toEqual(["seg-1", "seg-2"]);
  });

  it("get fetches a single segment by id", async () => {
    server.use(
      http.get("https://api.emporix.io/customer-segment/acme/segments/seg-1", () =>
        HttpResponse.json({ id: "seg-1", name: { en: "Premium" } }),
      ),
    );
    const s = await harness().svc.get("seg-1", CUST);
    expect((s as { id?: string }).id).toBe("seg-1");
  });
});

describe("SegmentService.listItems / listSegmentItems / getCategoryTree", () => {
  it("listItems sends siteCode/legalEntityId/onlyActive query params when provided", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.get(
        "https://api.emporix.io/customer-segment/acme/segments/items",
        ({ request }) => {
          q = new URL(request.url).searchParams;
          return HttpResponse.json([
            { type: "PRODUCT", item: { id: "p1" } },
            { type: "CATEGORY", item: { id: "c1" } },
          ]);
        },
      ),
    );
    const rows = await harness().svc.listItems(
      { siteCode: "main", legalEntityId: "le-1", onlyActive: true, q: "active" },
      CUST,
    );
    const params = q as URLSearchParams | null;
    expect(params?.get("siteCode")).toBe("main");
    expect(params?.get("legalEntityId")).toBe("le-1");
    expect(params?.get("onlyActive")).toBe("true");
    expect(params?.get("q")).toBe("active");
    expect(rows).toHaveLength(2);
  });

  it("listItems omits absent params", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.get(
        "https://api.emporix.io/customer-segment/acme/segments/items",
        ({ request }) => {
          q = new URL(request.url).searchParams;
          return HttpResponse.json([]);
        },
      ),
    );
    await harness().svc.listItems(undefined, CUST);
    const params = q as URLSearchParams | null;
    expect(params?.has("siteCode")).toBe(false);
    expect(params?.has("onlyActive")).toBe(false);
    expect(params?.has("q")).toBe(false);
  });

  it("listSegmentItems hits the per-segment items endpoint", async () => {
    server.use(
      http.get(
        "https://api.emporix.io/customer-segment/acme/segments/seg-1/items",
        () => HttpResponse.json([{ type: "PRODUCT", item: { id: "p1" } }]),
      ),
    );
    const rows = await harness().svc.listSegmentItems("seg-1", undefined, CUST);
    expect(rows).toHaveLength(1);
  });

  it("getCategoryTree calls /segments/items/category-trees", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.get(
        "https://api.emporix.io/customer-segment/acme/segments/items/category-trees",
        ({ request }) => {
          q = new URL(request.url).searchParams;
          return HttpResponse.json([{ id: "c1", code: "C1", name: { en: "Cat" } }]);
        },
      ),
    );
    const tree = await harness().svc.getCategoryTree({ siteCode: "main" }, CUST);
    expect((q as URLSearchParams | null)?.get("siteCode")).toBe("main");
    expect(tree).toHaveLength(1);
  });
});

describe("SegmentService hydrate helpers", () => {
  it("listMyProductIds filters listItems by type=PRODUCT (reads item.id)", async () => {
    server.use(
      http.get(
        "https://api.emporix.io/customer-segment/acme/segments/items",
        () =>
          HttpResponse.json([
            { type: "PRODUCT", item: { id: "p1" } },
            { type: "CATEGORY", item: { id: "c1" } },
            { type: "PRODUCT", item: { id: "p2" } },
          ]),
      ),
    );
    const ids = await harness().svc.listMyProductIds(undefined, CUST);
    expect(ids).toEqual(["p1", "p2"]);
  });

  it("listMyCategoryIds filters listItems by type=CATEGORY", async () => {
    server.use(
      http.get(
        "https://api.emporix.io/customer-segment/acme/segments/items",
        () =>
          HttpResponse.json([
            { type: "PRODUCT", item: { id: "p1" } },
            { type: "CATEGORY", item: { id: "c1" } },
          ]),
      ),
    );
    const ids = await harness().svc.listMyCategoryIds(undefined, CUST);
    expect(ids).toEqual(["c1"]);
  });

  it("listMyProducts hydrates via ONE products.searchByIds call and returns a PaginatedItems page", async () => {
    let searchCalls = 0;
    let pageItemsParams: URLSearchParams | null = null;
    server.use(
      http.get(
        "https://api.emporix.io/customer-segment/acme/segments/items",
        ({ request }) => {
          pageItemsParams = new URL(request.url).searchParams;
          return HttpResponse.json([
            { type: "PRODUCT", item: { id: "p1" } },
            { type: "PRODUCT", item: { id: "p2" } },
          ]);
        },
      ),
      http.post(
        "https://api.emporix.io/product/acme/products/search",
        async ({ request }) => {
          searchCalls += 1;
          const body = (await request.json()) as { q?: string };
          expect(body.q).toBe("id:(p1,p2)");
          return HttpResponse.json([{ id: "p1" }, { id: "p2" }]);
        },
      ),
    );
    const page = await harness().svc.listMyProducts(
      { pageNumber: 2, pageSize: 20, onlyActive: true },
      CUST,
    );
    expect(searchCalls).toBe(1);
    expect(page.items.map((p) => (p as { id?: string }).id)).toEqual(["p1", "p2"]);
    expect(page.pageNumber).toBe(2);
    expect(page.pageSize).toBe(20);
    expect(page.hasNextPage).toBe(false);
    const q = pageItemsParams as URLSearchParams | null;
    expect(q?.get("pageNumber")).toBe("2");
    expect(q?.get("pageSize")).toBe("20");
    expect(q?.get("onlyActive")).toBe("true");
  });

  it("listMyProducts.hasNextPage is true when the source page is full", async () => {
    server.use(
      http.get(
        "https://api.emporix.io/customer-segment/acme/segments/items",
        () =>
          HttpResponse.json([
            { type: "PRODUCT", item: { id: "p1" } },
            { type: "PRODUCT", item: { id: "p2" } },
          ]),
      ),
      http.post(
        "https://api.emporix.io/product/acme/products/search",
        () => HttpResponse.json([{ id: "p1" }, { id: "p2" }]),
      ),
    );
    const page = await harness().svc.listMyProducts(
      { pageNumber: 1, pageSize: 2 },
      CUST,
    );
    expect(page.hasNextPage).toBe(true);
  });

  it("listMyProducts returns items:[] (no HTTP search) when the page has zero PRODUCT rows", async () => {
    let hit = false;
    server.use(
      http.get(
        "https://api.emporix.io/customer-segment/acme/segments/items",
        () => HttpResponse.json([{ type: "CATEGORY", item: { id: "c1" } }]),
      ),
      http.post(
        "https://api.emporix.io/product/acme/products/search",
        () => {
          hit = true;
          return HttpResponse.json([]);
        },
      ),
    );
    const page = await harness().svc.listMyProducts(undefined, CUST);
    expect(hit).toBe(false);
    expect(page.items).toEqual([]);
  });

  it("listMyCategories hydrates via ONE categories.searchByIds call and returns a PaginatedItems page", async () => {
    let searchCalls = 0;
    server.use(
      http.get(
        "https://api.emporix.io/customer-segment/acme/segments/items",
        () =>
          HttpResponse.json([
            { type: "CATEGORY", item: { id: "c1" } },
            { type: "CATEGORY", item: { id: "c2" } },
          ]),
      ),
      http.post(
        "https://api.emporix.io/category/acme/categories/search",
        async ({ request }) => {
          searchCalls += 1;
          const body = (await request.json()) as { q?: string };
          expect(body.q).toBe("id:(c1,c2)");
          return HttpResponse.json([{ id: "c1" }, { id: "c2" }]);
        },
      ),
    );
    const page = await harness().svc.listMyCategories(undefined, CUST);
    expect(searchCalls).toBe(1);
    expect(page.items.map((c) => (c as { id?: string }).id)).toEqual(["c1", "c2"]);
  });
});
