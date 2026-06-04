import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { CartService } from "../../src/services/cart";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";
import { EmporixValidationError } from "../../src/core/errors";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
  http.post("https://api.emporix.io/cart/acme/carts", ({ request }) => {
    expect(request.headers.get("authorization")).toBe("Bearer anon");
    return HttpResponse.json({ cartId: "cart1", yrn: "urn:cart:acme;cart1" });
  }),
  http.post(
    "https://api.emporix.io/cart/acme/carts/customer-cart/merge",
    async ({ request }) => {
      expect(request.headers.get("authorization")).toBe("Bearer CUST");
      const body = (await request.json()) as { carts?: string[] };
      expect(body.carts).toEqual(["anon-1"]);
      return HttpResponse.json({ id: "cart-merged", items: [{ id: "i1" }] });
    },
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "cart" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io", provider: tokenProvider, logger,
    retry: { maxAttempts: 1 }, timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new CartService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

describe("CartService", () => {
  it("refuses calls without an explicit customer/anonymous context", async () => {
    // @ts-expect-error auth is required
    await expect(svc().create()).rejects.toBeInstanceOf(EmporixValidationError);
    await expect(
      svc().create({ currency: "EUR" }, { kind: "service" } as never),
    ).rejects.toBeInstanceOf(EmporixValidationError);
  });

  it("create() works with an anonymous context and returns the cartId", async () => {
    const c = await svc().create({ currency: "EUR" }, { kind: "anonymous" });
    expect(c.cartId).toBe("cart1");
  });

  it("merge() requires a customer context and returns the merged cart", async () => {
    await expect(
      svc().merge("customer-cart", ["anon-1"], { kind: "anonymous" }),
    ).rejects.toBeInstanceOf(EmporixValidationError);
    const merged = await svc().merge("customer-cart", ["anon-1"], {
      kind: "customer",
      token: "CUST",
    });
    expect(merged.id).toBe("cart-merged");
  });

  it("merge() accepts multiple anonymous cart ids in one call", async () => {
    let seenCarts: string[] | undefined;
    server.use(
      http.post(
        "https://api.emporix.io/cart/acme/carts/customer-cart/merge",
        async ({ request }) => {
          seenCarts = ((await request.json()) as { carts: string[] }).carts;
          return HttpResponse.json({ id: "cart-merged" });
        },
      ),
    );
    await svc().merge("customer-cart", ["anon-1", "anon-2"], {
      kind: "customer",
      token: "CUST",
    });
    expect(seenCarts).toEqual(["anon-1", "anon-2"]);
  });

  it("getCurrent() sends siteCode and returns the cart", async () => {
    let seenQuery: URLSearchParams | undefined;
    server.use(
      http.get("https://api.emporix.io/cart/acme/carts", ({ request }) => {
        seenQuery = new URL(request.url).searchParams;
        return HttpResponse.json({ id: "current-cart", items: [] });
      }),
    );
    const c = await svc().getCurrent(
      { kind: "customer", token: "CUST" },
      { siteCode: "main" },
    );
    expect(c?.id).toBe("current-cart");
    expect(seenQuery?.get("siteCode")).toBe("main");
    expect(seenQuery?.has("create")).toBe(false);
  });

  it("getCurrent({ create: true }) sends create=true", async () => {
    let seenQuery: URLSearchParams | undefined;
    server.use(
      http.get("https://api.emporix.io/cart/acme/carts", ({ request }) => {
        seenQuery = new URL(request.url).searchParams;
        return HttpResponse.json({ id: "created-cart", items: [] });
      }),
    );
    await svc().getCurrent(
      { kind: "customer", token: "CUST" },
      { siteCode: "main", create: true },
    );
    expect(seenQuery?.get("create")).toBe("true");
  });

  it("getCurrent() forwards optional type and legalEntityId", async () => {
    let seenQuery: URLSearchParams | undefined;
    server.use(
      http.get("https://api.emporix.io/cart/acme/carts", ({ request }) => {
        seenQuery = new URL(request.url).searchParams;
        return HttpResponse.json({ id: "x", items: [] });
      }),
    );
    await svc().getCurrent(
      { kind: "customer", token: "CUST" },
      { siteCode: "main", type: "shopping", legalEntityId: "le-1" },
    );
    expect(seenQuery?.get("type")).toBe("shopping");
    expect(seenQuery?.get("legalEntityId")).toBe("le-1");
  });

  it("getCurrent() returns null on a 404 (no cart, create=false)", async () => {
    server.use(
      http.get("https://api.emporix.io/cart/acme/carts", () =>
        HttpResponse.json({ message: "not found" }, { status: 404 }),
      ),
    );
    const c = await svc().getCurrent(
      { kind: "customer", token: "CUST" },
      { siteCode: "main" },
    );
    expect(c).toBeNull();
  });

  it("getCurrent() propagates non-404 errors", async () => {
    server.use(
      http.get("https://api.emporix.io/cart/acme/carts", () =>
        HttpResponse.json({ message: "boom" }, { status: 500 }),
      ),
    );
    await expect(
      svc().getCurrent(
        { kind: "customer", token: "CUST" },
        { siteCode: "main" },
      ),
    ).rejects.toThrow();
  });

  it("get() returns generated cart fields the old facade dropped", async () => {
    server.use(
      http.get("https://api.emporix.io/cart/acme/carts/c1", () =>
        HttpResponse.json({ id: "c1", items: [], totalPrice: { amount: 0, currency: "CHF" } }),
      ),
    );
    const c = await svc().get("c1", { kind: "anonymous" });
    expect(c.id).toBe("c1");
    expect((c as { totalPrice?: unknown }).totalPrice).toEqual({
      amount: 0,
      currency: "CHF",
    });
  });
});

describe("CartService.getCurrent with legalEntityId", () => {
  it("forwards legalEntityId as a query param so the server returns the company cart", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.get("https://api.emporix.io/cart/acme/carts", ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json({ id: "cart-le-1", siteCode: "main" });
      }),
    );
    await svc().getCurrent(
      { kind: "customer", token: "cust-tok" },
      { siteCode: "main", legalEntityId: "le-1" },
    );
    expect((q as URLSearchParams | null)?.get("siteCode")).toBe("main");
    expect((q as URLSearchParams | null)?.get("legalEntityId")).toBe("le-1");
  });
});

describe("CartService.addItemsBatch", () => {
  it("POSTs the array body to /itemsBatch and returns per-entry status", async () => {
    let body: unknown = null;
    server.use(
      http.post("https://api.emporix.io/cart/acme/carts/cart-1/itemsBatch", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json([
          { index: 0, status: 201, id: "ci-a", yrn: "urn:cart-item:acme;cart-1:ci-a" },
          { index: 1, status: 201, id: "ci-b" },
        ]);
      }),
    );
    const res = await svc().addItemsBatch(
      "cart-1",
      [
        { product: { id: "p-1" }, quantity: 2 } as never,
        { product: { id: "p-2" }, quantity: 1 } as never,
      ],
      { kind: "customer", token: "CUST" },
    );
    expect(Array.isArray(body)).toBe(true);
    expect((body as unknown[]).length).toBe(2);
    expect(res).toHaveLength(2);
    expect(res[0]?.status).toBe(201);
    expect(res[0]?.id).toBe("ci-a");
  });

  it("surfaces per-entry failures via status without throwing", async () => {
    server.use(
      http.post("https://api.emporix.io/cart/acme/carts/cart-1/itemsBatch", () =>
        HttpResponse.json([
          { index: 0, status: 201, id: "ci-a" },
          { index: 1, status: 404, errorMessage: "product discontinued" },
        ]),
      ),
    );
    const res = await svc().addItemsBatch(
      "cart-1",
      [
        { product: { id: "p-ok" }, quantity: 1 } as never,
        { product: { id: "p-gone" }, quantity: 1 } as never,
      ],
      { kind: "customer", token: "CUST" },
    );
    expect(res[0]?.status).toBe(201);
    expect(res[1]?.status).toBe(404);
    expect(res[1]?.errorMessage).toBe("product discontinued");
  });

  it("rejects without an explicit customer/anonymous context", async () => {
    await expect(
      svc().addItemsBatch("cart-1", [], { kind: "service" } as never),
    ).rejects.toBeInstanceOf(EmporixValidationError);
  });

  it("updateItem sends ?partial=true when requested (partial PUT)", async () => {
    let search = "?unset";
    let body: unknown = null;
    server.use(
      http.put("https://api.emporix.io/cart/acme/carts/c1/items/0", async ({ request }) => {
        search = new URL(request.url).search;
        body = await request.json();
        return HttpResponse.json({ id: "c1" });
      }),
    );
    await svc().updateItem("c1", "0", { quantity: 2 } as never, { kind: "anonymous" }, { partial: true });
    expect(search).toContain("partial=true");
    expect(body).toEqual({ quantity: 2 });
  });

  it("updateItem omits the partial query by default", async () => {
    let search = "?unset";
    server.use(
      http.put("https://api.emporix.io/cart/acme/carts/c1/items/0", ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json({ id: "c1" });
      }),
    );
    await svc().updateItem("c1", "0", { quantity: 2 } as never, { kind: "anonymous" });
    expect(search).toBe("");
  });
});
