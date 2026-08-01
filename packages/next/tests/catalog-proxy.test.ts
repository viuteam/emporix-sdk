import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { createEmporixCatalogRoute } from "../src/catalog-proxy";
import { createProxyTokenProvider, createProxyFetch } from "../src/catalog-client";
import { __resetEmporixClients } from "../src/client";

function stubFetch(): { urls: string[]; auths: Array<string | null> } {
  const urls: string[] = [];
  const auths: Array<string | null> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      urls.push(url);
      auths.push(new Headers(init?.headers).get("authorization"));
      // `sessionId` camelCase, the rest snake_case — Emporix's own shape.
      const body = url.includes("/customerlogin/auth/anonymous/")
        ? {
            access_token: "real-anon",
            refresh_token: "r",
            sessionId: "s",
            expires_in: 3600,
          }
        : { ok: true };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return { urls, auths };
}

function req(path: string): { request: Request; ctx: { params: Promise<{ path: string[] }> } } {
  const segments = path.split("/").filter((s) => s.length > 0);
  return {
    request: new Request(`https://shop.test/api/emporix/${path}`, {
      headers: { "sec-fetch-site": "same-origin", authorization: "Bearer proxied" },
    }),
    ctx: { params: Promise.resolve({ path: segments }) },
  };
}

beforeEach(() => {
  __resetEmporixClients();
  process.env.EMPORIX_TENANT = "viu";
  process.env.EMPORIX_STOREFRONT_CLIENT_ID = "storefront-id";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.EMPORIX_TENANT;
  delete process.env.EMPORIX_STOREFRONT_CLIENT_ID;
});

describe("createEmporixCatalogRoute — allowlist", () => {
  it("forwards a catalog product request", async () => {
    stubFetch();
    const route = createEmporixCatalogRoute();
    const { request, ctx } = req("product/viu/products/p1");
    expect((await route(request, ctx)).status).toBe(200);
  });

  it("rejects a cart request with 403", async () => {
    stubFetch();
    const route = createEmporixCatalogRoute();
    const { request, ctx } = req("cart/viu/carts/c1");
    expect((await route(request, ctx)).status).toBe(403);
  });

  it("rejects an order request with 403", async () => {
    stubFetch();
    const route = createEmporixCatalogRoute();
    const { request, ctx } = req("order/viu/orders/o1");
    expect((await route(request, ctx)).status).toBe(403);
  });

  it("rejects a customer request with 403", async () => {
    stubFetch();
    const route = createEmporixCatalogRoute();
    const { request, ctx } = req("customer/viu/login");
    expect((await route(request, ctx)).status).toBe(403);
  });

  it("rejects a foreign tenant with 403", async () => {
    stubFetch();
    const route = createEmporixCatalogRoute();
    const { request, ctx } = req("product/other/products/p1");
    expect((await route(request, ctx)).status).toBe(403);
  });

  it("rejects a cross-site request", async () => {
    stubFetch();
    const route = createEmporixCatalogRoute();
    const request = new Request("https://shop.test/api/emporix/product/viu/products/p1", {
      headers: { "sec-fetch-site": "cross-site" },
    });
    const ctx = { params: Promise.resolve({ path: ["product", "viu", "products", "p1"] }) };
    expect((await route(request, ctx)).status).toBe(403);
  });
});

describe("createEmporixCatalogRoute — token substitution", () => {
  it("never forwards the placeholder Authorization header", async () => {
    const f = stubFetch();
    const route = createEmporixCatalogRoute();
    const { request, ctx } = req("product/viu/products/p1");
    await route(request, ctx);
    expect(f.auths).not.toContain("Bearer proxied");
  });

  it("sends the server's real anonymous token upstream", async () => {
    const f = stubFetch();
    const route = createEmporixCatalogRoute();
    const { request, ctx } = req("product/viu/products/p1");
    await route(request, ctx);
    expect(f.auths.some((a) => a === "Bearer real-anon")).toBe(true);
  });
});

describe("createProxyTokenProvider", () => {
  it("makes NO network call — this is what 'no token in the browser' means", async () => {
    // The one assertion that proves the security claim. Everything else in this
    // mode is structure; this is the measurement.
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const provider = createProxyTokenProvider();
    const session = await provider.getAnonymousToken();
    expect(spy).not.toHaveBeenCalled();
    expect(session.accessToken).toBeTruthy();
  });

  it("returns a placeholder for a service token too, without a network call", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const provider = createProxyTokenProvider();
    await provider.getToken("backend");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("createProxyFetch", () => {
  it("rewrites an Emporix URL onto the local base", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        seen.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        return new Response("{}", { status: 200 });
      }),
    );
    const f = createProxyFetch({ base: "/api/emporix" });
    await f("https://api.emporix.io/product/viu/products/p1");
    expect(seen[0]).toBe("/api/emporix/product/viu/products/p1");
  });

  it("preserves the query string", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        seen.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        return new Response("{}", { status: 200 });
      }),
    );
    const f = createProxyFetch({ base: "/api/emporix" });
    await f("https://api.emporix.io/product/viu/products?pageSize=5");
    expect(seen[0]).toBe("/api/emporix/product/viu/products?pageSize=5");
  });
});
