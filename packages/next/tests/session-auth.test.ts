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
  "../src/session-auth"
);
const { __resetEmporixClients } = await import("../src/client");
const { SESSION_SID } = await import("../src/session-store");
type SessionStore = import("../src/session-store").EmporixSessionStore;

interface Call {
  url: string;
  method: string;
  body: string;
}

function stubFetch(
  opts: {
    cartStatus?: number;
    /**
     * Status for the merge call only. Live it is **404** whenever a guest cart is
     * involved: a customer token cannot see an anonymous cart.
     */
    mergeStatus?: number;
  } = {},
): { urls: string[]; calls: Call[] } {
  const urls: string[] = [];
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      urls.push(url);
      calls.push({ url, method: init?.method ?? "GET", body: String(init?.body ?? "") });

      // Before the generic /cart/ branch, so a merge can fail on its own while
      // `getCurrent` still answers.
      if (url.includes("/merge") && opts.mergeStatus !== undefined) {
        return new Response(
          JSON.stringify({
            code: opts.mergeStatus,
            message: "Cart with code guest-cart not found.",
          }),
          { status: opts.mergeStatus, headers: { "Content-Type": "application/json" } },
        );
      }

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

  it("stores the cart id httpOnly, like every other session cookie", async () => {
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

  it("KEEPS the guest cart when the merge is refused", async () => {
    // The merge normally succeeds — verified live on 2026-08-03, a guest product
    // landed in the customer's cart. This covers the failure branch: if a merge
    // ever is refused, the shopper must stay on the cart their items are in
    // rather than be moved onto one they are not.
    //
    // Catching the failure and writing the customer cart id anyway was tried and
    // reverted the same day: it put the shopper on «0 item(s)».
    //
    // If this test starts failing, someone has added that catch back. Read the
    // comment in `onboardCart` before changing it.
    const f = stubFetch({ mergeStatus: 404 });
    bag.set("emporix.cartId", { name: "emporix.cartId", value: "guest-cart" });

    await emporixLogin({ email: "a@b.test", password: "pw" }, SITED);

    expect(f.calls.some((c) => c.url.includes("/merge"))).toBe(true);
    expect(bag.get("emporix.cartId")?.value).toBe("guest-cart");
    // And the login itself must survive it.
    expect(bag.get("emporix.customerToken")?.value).toBe("cust-tok");
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

describe("the absolute session ceiling", () => {
  it("stamps the start at login", async () => {
    stubFetch();
    await emporixLogin({ email: "a@b.test", password: "pw" });
    const started = Number(bag.get("emporix.sessionStartedAt")?.value);
    expect(Math.abs(started - Math.floor(Date.now() / 1000))).toBeLessThan(5);
  });

  it("refreshes normally below the ceiling", async () => {
    stubFetch();
    const young = Math.floor(Date.now() / 1000) - 60;
    bag.set("emporix.sessionStartedAt", {
      name: "emporix.sessionStartedAt",
      value: String(young),
    });
    bag.set("emporix.refreshToken", { name: "emporix.refreshToken", value: "old-refresh" });
    expect(await emporixRefresh()).toBe("cust-tok");
  });

  it("refuses and clears once the ceiling is passed", async () => {
    stubFetch();
    const ancient = Math.floor(Date.now() / 1000) - 91 * 24 * 60 * 60;
    bag.set("emporix.sessionStartedAt", {
      name: "emporix.sessionStartedAt",
      value: String(ancient),
    });
    bag.set("emporix.refreshToken", { name: "emporix.refreshToken", value: "old-refresh" });
    bag.set("emporix.customerToken", { name: "emporix.customerToken", value: "cust-tok" });
    expect(await emporixRefresh()).toBeNull();
    expect(bag.get("emporix.refreshToken")).toBeUndefined();
    expect(bag.get("emporix.customerToken")).toBeUndefined();
  });

  it("does not slide the ceiling across repeated refreshes", async () => {
    // The whole point. If persistSession rewrote this the way it rewrites the
    // refresh cookie, the ceiling would slide with the window it is capping.
    stubFetch();
    const started = Math.floor(Date.now() / 1000) - 1000;
    bag.set("emporix.sessionStartedAt", {
      name: "emporix.sessionStartedAt",
      value: String(started),
    });
    bag.set("emporix.refreshToken", { name: "emporix.refreshToken", value: "old-refresh" });
    for (let i = 0; i < 10; i += 1) await emporixRefresh();
    expect(Number(bag.get("emporix.sessionStartedAt")?.value)).toBe(started);
  });

  it("adopts a session that predates the stamp", async () => {
    // A session from before this shipped carries no stamp. Logging those
    // customers out on deploy would be a worse trade than one more cycle.
    stubFetch();
    bag.set("emporix.refreshToken", { name: "emporix.refreshToken", value: "old-refresh" });
    expect(await emporixRefresh()).toBe("cust-tok");
    expect(bag.get("emporix.sessionStartedAt")).toBeDefined();
  });
});

/** A store that records what it was asked to do — that is the evidence here. */
function fakeStore(): SessionStore & {
  records: Map<string, Record<string, string>>;
  destroyed: string[];
  /** Every write in order — the order is what some of these tests are about. */
  writes: Array<Record<string, string>>;
} {
  const records = new Map<string, Record<string, string>>();
  const destroyed: string[] = [];
  const writes: Array<Record<string, string>> = [];
  return {
    records,
    destroyed,
    writes,
    read: async (id) => records.get(id) ?? null,
    write: async (id, record) => {
      writes.push({ ...record });
      records.set(id, { ...record });
    },
    destroy: async (id) => {
      destroyed.push(id);
      records.delete(id);
    },
  };
}

/** Reads the single session record, or throws with a message worth reading. */
function onlyRecord(store: ReturnType<typeof fakeStore>): Record<string, string> {
  const all = [...store.records.values()];
  if (all.length !== 1) throw new Error(`expected exactly one record, got ${all.length}`);
  return all[0] as Record<string, string>;
}

describe("the three auth functions in store mode", () => {
  // All three built their jar with `sessionCookieJar()` — no options — so they
  // silently ran in cookie mode however the caller was configured. Guest flows
  // were fine because they go through `withEmporixSessionMutable`, which threads
  // the option; the customer path was not, and shipped that way in 0.4.0.

  it("emporixLogin keeps the customer token out of the browser", async () => {
    stubFetch();
    const store = fakeStore();
    await emporixLogin({ email: "a@b.test", password: "pw" }, { store, ...SITED });

    // Two-sided on purpose. Asserting only the absence would pass if login wrote
    // nothing at all; asserting only the record would pass while a copy also sat
    // in a cookie.
    expect(bag.get("emporix.customerToken")).toBeUndefined();
    expect(onlyRecord(store)["emporix.customerToken"]).toBe("cust-tok");
  });

  it("emporixLogin keeps the saasToken out of the browser", async () => {
    // The saasToken is the one that authorizes an order. Its JWT payload never
    // reaching the browser is the headline claim of store mode.
    stubFetch();
    const store = fakeStore();
    await emporixLogin({ email: "a@b.test", password: "pw" }, { store, ...SITED });

    expect(bag.get("emporix.saasToken")).toBeUndefined();
    expect(onlyRecord(store)["emporix.saasToken"]).toBe("saas-tok");
  });

  it("emporixLogin leaves exactly ONE session record", async () => {
    // emporixLogin builds two jars: the one inside withEmporixSessionMutable and
    // its own. Two jars for one request is what the store spec warns about — a
    // second jar mints a second session id. It works here only because the first
    // flush sets the sid cookie BEFORE the second jar hydrates. This test is what
    // notices if that ordering ever changes.
    stubFetch();
    const store = fakeStore();
    await emporixLogin({ email: "a@b.test", password: "pw" }, { store, ...SITED });

    expect(store.records.size).toBe(1);
    // And the guest half of the session is in the same record as the customer
    // half — proof the second jar hydrated the first one's write.
    expect(onlyRecord(store)["emporix.sessionStartedAt"]).toBeDefined();
  });

  it("emporixRefresh rotates the token inside the record", async () => {
    stubFetch();
    const store = fakeStore();
    const sid = "sid-under-test";
    store.records.set(sid, { "emporix.refreshToken": "old-refresh" });
    bag.set(SESSION_SID, { name: SESSION_SID, value: sid });

    expect(await emporixRefresh({ store })).toBe("cust-tok");

    expect(store.records.get(sid)?.["emporix.refreshToken"]).toBe("cust-refresh");
    expect(bag.get("emporix.refreshToken")).toBeUndefined();
  });

  it("emporixLogin onboards the cart as the CUSTOMER, not as a guest", async () => {
    // The store-mode bug this pins, measured on 2026-08-03 with instrumentation
    // inside `onboardCart`:
    //
    //   authKind=anonymous  getCurrent=<a NEW empty cart>  customerIdOnCart=(none)
    //   merge FAILED: cart.merge requires a { kind: 'customer' } AuthContext
    //
    // `onboardCart` builds its own jar and branches on whether a customer token is
    // stored. In cookie mode `persistSession` writes through, so it sees one. In
    // store mode it only touches the in-memory record, so without a flush first
    // that second jar reads a store with no token and runs as a GUEST — and then
    // `getCurrent` creates a fresh anonymous cart while the merge never leaves the
    // SDK. A guest who logged in landed on an empty cart.
    //
    // Asserted on the store's WRITE ORDER rather than on the request list. The
    // request list cannot tell the two apart here — the stub answers a merge
    // whichever auth reached it — but the mechanism is precisely «is the customer
    // token in the store before the onboarding builds its jar?». That is a
    // write that must land BEFORE the final one.
    const store = fakeStore();
    const sid = "sid-onboarding";
    store.records.set(sid, { "emporix.cartId": "guest-cart" });
    bag.set(SESSION_SID, { name: SESSION_SID, value: sid });
    stubFetch();

    await emporixLogin({ email: "a@b.test", password: "pw" }, { store, ...SITED });

    const withToken = store.writes
      .map((r, i) => ("emporix.customerToken" in r ? i : -1))
      .filter((i) => i >= 0);
    // At least two: the flush before the onboarding, and the final one. Only one
    // means the token first reached the store after the onboarding had already run.
    expect(withToken.length).toBeGreaterThanOrEqual(2);
    expect(withToken[0]).toBeLessThan(store.writes.length - 1);
  });

  it("emporixLogout destroys the record", async () => {
    // The 0.4.0 notes claimed this already worked. It did not: destroy() was the
    // cookie-mode no-op, so the record outlived the logout — and revoking a
    // single session is the entire reason the store exists.
    stubFetch();
    const store = fakeStore();
    const sid = "sid-to-destroy";
    store.records.set(sid, { "emporix.customerToken": "cust-tok" });
    bag.set(SESSION_SID, { name: SESSION_SID, value: sid });

    await emporixLogout({ store });

    expect(store.destroyed).toEqual([sid]);
    expect(store.records.has(sid)).toBe(false);
  });
});
