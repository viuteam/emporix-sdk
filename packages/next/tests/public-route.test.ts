import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { createEmporixPublicRoute } from "../src/public-route";
import { createProxyTokenProvider, createProxyFetch } from "../src/public-client";
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

describe("createEmporixPublicRoute — allowlist", () => {
  it("forwards a catalog product request", async () => {
    stubFetch();
    const route = createEmporixPublicRoute();
    const { request, ctx } = req("product/viu/products/p1");
    expect((await route(request, ctx)).status).toBe(200);
  });

  it("rejects a cart request with 403", async () => {
    stubFetch();
    const route = createEmporixPublicRoute();
    const { request, ctx } = req("cart/viu/carts/c1");
    expect((await route(request, ctx)).status).toBe(403);
  });

  it("rejects an order request with 403", async () => {
    stubFetch();
    const route = createEmporixPublicRoute();
    const { request, ctx } = req("order/viu/orders/o1");
    expect((await route(request, ctx)).status).toBe(403);
  });

  it("rejects a customer request with 403", async () => {
    stubFetch();
    const route = createEmporixPublicRoute();
    const { request, ctx } = req("customer/viu/login");
    expect((await route(request, ctx)).status).toBe(403);
  });

  it("rejects a foreign tenant with 403", async () => {
    stubFetch();
    const route = createEmporixPublicRoute();
    const { request, ctx } = req("product/other/products/p1");
    expect((await route(request, ctx)).status).toBe(403);
  });

  it("rejects a cross-site request", async () => {
    stubFetch();
    const route = createEmporixPublicRoute();
    const request = new Request("https://shop.test/api/emporix/product/viu/products/p1", {
      headers: { "sec-fetch-site": "cross-site" },
    });
    const ctx = { params: Promise.resolve({ path: ["product", "viu", "products", "p1"] }) };
    expect((await route(request, ctx)).status).toBe(403);
  });
});

describe("createEmporixPublicRoute — token substitution", () => {
  it("never forwards the placeholder Authorization header", async () => {
    const f = stubFetch();
    const route = createEmporixPublicRoute();
    const { request, ctx } = req("product/viu/products/p1");
    await route(request, ctx);
    expect(f.auths).not.toContain("Bearer proxied");
  });

  it("sends the server's real anonymous token upstream", async () => {
    const f = stubFetch();
    const route = createEmporixPublicRoute();
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

  it("does NOT rewrite a lookalike host", async () => {
    // `startsWith("https://api.emporix.io")` matches this too — CodeQL caught
    // that as js/incomplete-url-substring-sanitization. Origins are compared
    // after parsing, so a different host is passed through untouched.
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        seen.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        return new Response("{}", { status: 200 });
      }),
    );
    const f = createProxyFetch({ base: "/api/emporix" });
    await f("https://api.emporix.io.evil.test/product/viu/products");
    expect(seen[0]).toBe("https://api.emporix.io.evil.test/product/viu/products");
  });

  it("passes a relative URL through untouched", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        seen.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        return new Response("{}", { status: 200 });
      }),
    );
    const f = createProxyFetch({ base: "/api/emporix" });
    await f("/some/local/path");
    expect(seen[0]).toBe("/some/local/path");
  });
});

describe("the public-client entry", () => {
  it("is wired under ./public-client and carries no server-only guard", async () => {
    // Unlike /session and /service this one is MEANT for the browser — it must
    // stay a plain entry, and tsup must give it the "use client" banner
    // (scripts/check-dist.mjs enforces the banner on the built file).
    const pkg = (await import("../package.json")) as unknown as {
      default: { exports: Record<string, unknown> };
    };
    expect(pkg.default.exports["./public-client"]).toEqual({
      types: "./dist/public-client.d.ts",
      import: "./dist/public-client.js",
      require: "./dist/public-client.cjs",
    });
  });

  it("no longer exposes the old /catalog-client subpath", async () => {
    // `catalog` named the first use case, not the rule. The allowlist also
    // admits price, availability and site — and Emporix has a real Catalog
    // service this has nothing to do with.
    const pkg = (await import("../package.json")) as unknown as {
      default: { exports: Record<string, unknown> };
    };
    expect(pkg.default.exports["./catalog-client"]).toBeUndefined();
  });
});
