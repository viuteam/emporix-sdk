import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

const bag = new Map<string, { name: string; value: string; opts?: Record<string, unknown> }>();
const jar = {
  get: (name: string) => bag.get(name),
  set: (name: string, value: string, opts?: Record<string, unknown>) => {
    bag.set(name, { name, value, ...(opts ? { opts } : {}) });
  },
  delete: (name: string) => {
    bag.delete(name);
  },
};
const headerBag = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve(jar),
  headers: () => Promise.resolve({ get: (k: string) => headerBag.get(k) ?? null }),
}));

const { emporixLogin, emporixLogout, emporixRefresh, assertSameOrigin } = await import(
  "../src/bff-auth"
);
const { __resetEmporixClients } = await import("../src/client");

interface Call {
  url: string;
  method: string;
  body: string;
}

function stubFetch(opts: { cartStatus?: number } = {}): { urls: string[]; calls: Call[] } {
  const urls: string[] = [];
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      urls.push(url);
      calls.push({ url, method: init?.method ?? "GET", body: String(init?.body ?? "") });

      if (url.includes("/cart/")) {
        const status = opts.cartStatus ?? 200;
        if (status !== 200) {
          return new Response(JSON.stringify({ message: "cart trouble" }), {
            status,
            headers: { "Content-Type": "application/json" },
          });
        }
        // `getCurrent` returns a Cart with `.id`; `create` would return
        // `CartCreated` with `.cartId`. The onboarding reads `.id`.
        return new Response(JSON.stringify({ id: "cust-cart" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // `sessionId` is camelCase while the rest is snake_case — Emporix's own
      // shape, mirrored by the SDK at core/auth.ts:372.
      const body = url.includes("/customerlogin/auth/anonymous/")
        ? {
            access_token: "anon-access",
            refresh_token: "anon-refresh",
            sessionId: "sess-1",
            expires_in: 3600,
          }
        : url.includes("/login") || url.includes("/refreshauthtoken")
          ? { accessToken: "cust-tok", refreshToken: "cust-refresh", saas_token: "saas-tok" }
          : {};
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return { urls, calls };
}

/** Every login that should onboard a cart needs a site context. */
const SITED = { context: { siteCode: "main" } };

beforeEach(() => {
  bag.clear();
  headerBag.clear();
  __resetEmporixClients();
  process.env.EMPORIX_TENANT = "viu";
  process.env.EMPORIX_STOREFRONT_CLIENT_ID = "storefront-id";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.EMPORIX_TENANT;
  delete process.env.EMPORIX_STOREFRONT_CLIENT_ID;
});

describe("emporixLogin", () => {
  it("writes all three token cookies httpOnly", async () => {
    stubFetch();
    await emporixLogin({ email: "a@b.test", password: "pw" });
    for (const name of ["emporix.customerToken", "emporix.refreshToken", "emporix.saasToken"]) {
      expect(bag.get(name)?.opts).toMatchObject({ httpOnly: true });
    }
  });

  it("stores the customer token returned by Emporix", async () => {
    stubFetch();
    await emporixLogin({ email: "a@b.test", password: "pw" });
    expect(bag.get("emporix.customerToken")?.value).toBe("cust-tok");
  });

  it("returns nothing — a token must never reach the caller's response body", async () => {
    stubFetch();
    const result = await emporixLogin({ email: "a@b.test", password: "pw" });
    expect(result).toBeUndefined();
  });

  it("reuses the guest's existing anonymous session, so the cart survives", async () => {
    // The property that matters: an existing guest session is REFRESHED
    // (sessionId preserved) rather than replaced by a fresh anonymous login.
    // Emporix binds the cart to the session, so a fresh login loses the cart.
    //
    // An earlier version of this test asserted only that the anonymous endpoint
    // was called before /login. That was vacuous — the SDK resolves
    // auth.anonymous() for the login call anyway, so it passed with or without
    // the behaviour under test.
    const f = stubFetch();
    bag.set("emporix.anonymousSession", {
      name: "emporix.anonymousSession",
      value: JSON.stringify({ refreshToken: "guest-r", sessionId: "guest-sess" }),
    });
    await emporixLogin({ email: "a@b.test", password: "pw" });
    expect(f.urls.some((u) => u.includes("/anonymous/refresh"))).toBe(true);
    expect(f.urls.some((u) => u.includes("/anonymous/login"))).toBe(false);
  });

  it("drops the anonymous session cookie once a customer token exists", async () => {
    stubFetch();
    bag.set("emporix.anonymousSession", {
      name: "emporix.anonymousSession",
      value: JSON.stringify({ refreshToken: "r", sessionId: "s" }),
    });
    await emporixLogin({ email: "a@b.test", password: "pw" });
    expect(bag.get("emporix.anonymousSession")).toBeUndefined();
  });
});

describe("emporixLogin cart onboarding", () => {
  // Found live: after a checkout closed the previous cart, the next addToCart
  // called `carts.create` and Emporix answered 409 — a customer may hold only
  // one open cart. Onboarding adopts the existing one instead.
  it("adopts the customer's cart and stores its id", async () => {
    stubFetch();
    await emporixLogin({ email: "a@b.test", password: "pw" }, SITED);
    expect(bag.get("emporix.cartId")?.value).toBe("cust-cart");
  });

  it("stores the cart id httpOnly, like every other bff cookie", async () => {
    stubFetch();
    await emporixLogin({ email: "a@b.test", password: "pw" }, SITED);
    expect(bag.get("emporix.cartId")?.opts).toMatchObject({ httpOnly: true });
  });

  it("merges the guest cart into the customer cart", async () => {
    const f = stubFetch();
    bag.set("emporix.cartId", { name: "emporix.cartId", value: "guest-cart" });
    await emporixLogin({ email: "a@b.test", password: "pw" }, SITED);
    const merge = f.calls.find((c) => c.url.includes("/merge"));
    // The path id is the CUSTOMER cart; the body lists the anonymous ones.
    expect(merge?.url).toContain("cust-cart");
    expect(merge?.body).toContain("guest-cart");
    expect(bag.get("emporix.cartId")?.value).toBe("cust-cart");
  });

  it("does not merge a cart into itself", async () => {
    const f = stubFetch();
    bag.set("emporix.cartId", { name: "emporix.cartId", value: "cust-cart" });
    await emporixLogin({ email: "a@b.test", password: "pw" }, SITED);
    expect(f.calls.some((c) => c.url.includes("/merge"))).toBe(false);
  });

  it("logs in anyway when the cart call fails", async () => {
    // A cart in a bad state must not cost the customer their session.
    stubFetch({ cartStatus: 500 });
    await emporixLogin({ email: "a@b.test", password: "pw" }, SITED);
    expect(bag.get("emporix.customerToken")?.value).toBe("cust-tok");
    expect(bag.get("emporix.cartId")).toBeUndefined();
  });

  it("skips cart onboarding without a siteCode", async () => {
    // `getCurrent` requires one; guessing a site would be worse than skipping.
    const f = stubFetch();
    await emporixLogin({ email: "a@b.test", password: "pw" });
    expect(f.calls.some((c) => c.url.includes("/cart/"))).toBe(false);
  });
});

describe("emporixRefresh", () => {
  it("rotates the stored tokens and returns the new access token", async () => {
    stubFetch();
    bag.set("emporix.refreshToken", { name: "emporix.refreshToken", value: "old-refresh" });
    const token = await emporixRefresh();
    expect(token).toBe("cust-tok");
    expect(bag.get("emporix.refreshToken")?.value).toBe("cust-refresh");
  });

  it("returns null and writes nothing when there is no refresh cookie", async () => {
    stubFetch();
    expect(await emporixRefresh()).toBeNull();
    expect(bag.get("emporix.customerToken")).toBeUndefined();
  });

  it("carries the stored saasToken forward — refresh does not re-mint it", async () => {
    const f = stubFetch();
    bag.set("emporix.refreshToken", { name: "emporix.refreshToken", value: "old-refresh" });
    bag.set("emporix.saasToken", { name: "emporix.saasToken", value: "saas-original" });
    await emporixRefresh();
    expect(f.urls.some((u) => u.includes("/refreshauthtoken"))).toBe(true);
    expect(bag.get("emporix.saasToken")?.value).toBeTruthy();
  });
});

describe("emporixLogout", () => {
  it("clears every secret cookie", async () => {
    stubFetch();
    const names = [
      "emporix.customerToken",
      "emporix.refreshToken",
      "emporix.saasToken",
      "emporix.cartId",
      "emporix.activeLegalEntityId",
    ];
    for (const n of names) bag.set(n, { name: n, value: "x" });
    await emporixLogout();
    for (const n of names) expect(bag.get(n)).toBeUndefined();
  });

  it("invalidates server-side before clearing locally", async () => {
    const f = stubFetch();
    bag.set("emporix.customerToken", { name: "emporix.customerToken", value: "cust-tok" });
    await emporixLogout();
    expect(f.urls.some((u) => u.includes("/logout"))).toBe(true);
  });

  it("clears locally even when the server call fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    bag.set("emporix.customerToken", { name: "emporix.customerToken", value: "cust-tok" });
    await emporixLogout();
    expect(bag.get("emporix.customerToken")).toBeUndefined();
  });
});

describe("assertSameOrigin", () => {
  it("accepts a same-origin request", () => {
    const r = new Request("https://shop.test/api/x", {
      method: "POST",
      headers: { "sec-fetch-site": "same-origin" },
    });
    expect(() => assertSameOrigin(r)).not.toThrow();
  });

  it("rejects a cross-site request", () => {
    const r = new Request("https://shop.test/api/x", {
      method: "POST",
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(() => assertSameOrigin(r)).toThrow(/cross-site/i);
  });

  it("rejects a request with neither Sec-Fetch-Site nor Origin", () => {
    // Otherwise an attacker simply omits the header.
    const r = new Request("https://shop.test/api/x", { method: "POST" });
    expect(() => assertSameOrigin(r)).toThrow();
  });

  it("falls back to Origin when Sec-Fetch-Site is absent", () => {
    const ok = new Request("https://shop.test/api/x", {
      method: "POST",
      headers: { origin: "https://shop.test" },
    });
    const bad = new Request("https://shop.test/api/x", {
      method: "POST",
      headers: { origin: "https://evil.test" },
    });
    expect(() => assertSameOrigin(ok)).not.toThrow();
    expect(() => assertSameOrigin(bad)).toThrow();
  });
});
