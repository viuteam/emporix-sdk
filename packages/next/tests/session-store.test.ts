import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import type { EmporixSessionStore } from "../src/session-store";

const bag = new Map<string, { name: string; value: string; opts?: Record<string, unknown> }>();
const cookieJar = {
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
  cookies: () => Promise.resolve(cookieJar),
  headers: () => Promise.resolve({ get: (k: string) => headerBag.get(k) ?? null }),
}));

const { emporixSessionHandle } = await import("../src/session-cookies");
const { SESSION_SID } = await import("../src/session-store");

/**
 * A Map-backed store. Deliberately not exported from the package — a consumer
 * who needs one for their own tests can write these fifteen lines.
 */
function fakeStore(): EmporixSessionStore & {
  records: Map<string, { record: Record<string, string>; ttl: number }>;
} {
  const records = new Map<string, { record: Record<string, string>; ttl: number }>();
  return {
    records,
    read: async (id: string) => records.get(id)?.record ?? null,
    write: async (id: string, record: Record<string, string>, ttl: number) => {
      records.set(id, { record: { ...record }, ttl });
    },
    destroy: async (id: string) => {
      records.delete(id);
    },
  };
}

beforeEach(() => {
  bag.clear();
  headerBag.clear();
  headerBag.set("x-forwarded-proto", "https");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cookie mode is untouched", () => {
  it("writes values into cookies when no store is configured", async () => {
    const j = await emporixSessionHandle();
    j.set("emporix.customerToken", "tok-1", 3600);
    await j.flush();
    expect(bag.get("__Host-emporix.customerToken")?.value).toBe("tok-1");
    expect(bag.get(`__Host-${SESSION_SID}`)).toBeUndefined();
  });
});

describe("store mode", () => {
  it("puts only the sid in a cookie, never the token", async () => {
    const store = fakeStore();
    const j = await emporixSessionHandle({ store });
    j.set("emporix.customerToken", "tok-1", 3600);
    await j.flush();
    expect(bag.get(`__Host-${SESSION_SID}`)).toBeDefined();
    expect(bag.get("__Host-emporix.customerToken")).toBeUndefined();
    for (const c of bag.values()) expect(c.value).not.toContain("tok-1");
  });

  it("marks the sid httpOnly", async () => {
    const store = fakeStore();
    const j = await emporixSessionHandle({ store });
    j.set("emporix.customerToken", "tok-1", 3600);
    await j.flush();
    expect(bag.get(`__Host-${SESSION_SID}`)?.opts).toMatchObject({ httpOnly: true });
  });

  it("reads a value back on a second request with the same sid", async () => {
    const store = fakeStore();
    const first = await emporixSessionHandle({ store });
    first.set("emporix.customerToken", "tok-1", 3600);
    await first.flush();

    const second = await emporixSessionHandle({ store });
    expect(second.get("emporix.customerToken")).toBe("tok-1");
  });

  it("treats an unknown sid as an empty session, not an error", async () => {
    const store = fakeStore();
    bag.set(`__Host-${SESSION_SID}`, { name: `__Host-${SESSION_SID}`, value: "never-existed" });
    const j = await emporixSessionHandle({ store });
    expect(j.get("emporix.customerToken")).toBeNull();
  });

  it("survives a store whose read throws", async () => {
    // A Redis outage must degrade to «logged out», not to a 500 on every page.
    const store = fakeStore();
    store.read = async () => {
      throw new Error("connection refused");
    };
    bag.set(`__Host-${SESSION_SID}`, { name: `__Host-${SESSION_SID}`, value: "some-id" });
    const j = await emporixSessionHandle({ store });
    expect(j.get("emporix.customerToken")).toBeNull();
  });

  it("keeps siteCode a cookie even in store mode", async () => {
    // The site proxy writes it browser-readable on purpose.
    const store = fakeStore();
    const j = await emporixSessionHandle({ store });
    j.set("emporix.siteCode", "main", 3600);
    await j.flush();
    expect(bag.get("__Host-emporix.siteCode")?.value).toBe("main");
    expect(store.records.size).toBe(0);
  });

  it("a read-only set never reaches the store", async () => {
    // Next forbids a cookie write during render, but nothing stops a store
    // write — the mistake would be invisible and would move real state.
    //
    // The protection lives in `set`, which no-ops and therefore never marks the
    // record dirty. Mutating the `readOnly` check inside `flush` does NOT fail
    // this test, because that check can never fire: `dirty` is only ever set by
    // `set` and `delete`, both of which return first. It stays as belt and
    // braces, and this comment is here so nobody mistakes it for verified.
    const store = fakeStore();
    const j = await emporixSessionHandle({ store, readOnly: true });
    j.set("emporix.customerToken", "tok-1", 3600);
    await j.flush();
    expect(store.records.size).toBe(0);
  });

  it("a read-only destroy leaves the record alone", async () => {
    // This guard IS load-bearing: destroy calls store.destroy directly and
    // never looks at `dirty`, so without the readOnly check a Server Component
    // render could delete a live session.
    const store = fakeStore();
    const first = await emporixSessionHandle({ store });
    first.set("emporix.customerToken", "tok-1", 3600);
    await first.flush();

    const readOnlyHandle = await emporixSessionHandle({ store, readOnly: true });
    await readOnlyHandle.destroy();
    expect(store.records.size).toBe(1);
  });

  it("deletes a value from the record", async () => {
    const store = fakeStore();
    const first = await emporixSessionHandle({ store });
    first.set("emporix.customerToken", "tok-1", 3600);
    await first.flush();

    const second = await emporixSessionHandle({ store });
    second.delete("emporix.customerToken");
    await second.flush();

    const third = await emporixSessionHandle({ store });
    expect(third.get("emporix.customerToken")).toBeNull();
  });

  it("does not touch the store when nothing changed", async () => {
    const store = fakeStore();
    const j = await emporixSessionHandle({ store });
    await j.flush();
    expect(store.records.size).toBe(0);
  });

  it("destroys the record and drops the sid cookie", async () => {
    const store = fakeStore();
    const first = await emporixSessionHandle({ store });
    first.set("emporix.customerToken", "tok-1", 3600);
    await first.flush();

    const second = await emporixSessionHandle({ store });
    await second.destroy();
    expect(store.records.size).toBe(0);
    expect(bag.get(`__Host-${SESSION_SID}`)).toBeUndefined();
  });
});

describe("lifetimes", () => {
  it("gives a guest session the sliding guest window", async () => {
    const store = fakeStore();
    const j = await emporixSessionHandle({ store });
    j.set("emporix.anonymousSession", '{"refreshToken":"r","sessionId":"s"}', 3600);
    await j.flush();
    const [entry] = [...store.records.values()];
    expect(entry?.ttl).toBe(7 * 24 * 60 * 60);
  });

  it("gives a customer session the time left until the ceiling", async () => {
    const store = fakeStore();
    const j = await emporixSessionHandle({ store });
    const tenDaysAgo = Math.floor(Date.now() / 1000) - 10 * 24 * 60 * 60;
    j.set("emporix.customerToken", "tok-1", 3600);
    j.set("emporix.sessionStartedAt", String(tenDaysAgo), 3600);
    await j.flush();
    const [entry] = [...store.records.values()];
    // 90 days minus the 10 already spent, give or take a second of test runtime.
    expect(entry?.ttl).toBeGreaterThan(79 * 24 * 60 * 60);
    expect(entry?.ttl).toBeLessThanOrEqual(80 * 24 * 60 * 60);
  });
});

describe("all three readers see the store", () => {
  it("emporixSession reads the session out of the store", async () => {
    const store = fakeStore();
    const seed = await emporixSessionHandle({ store });
    seed.set("emporix.customerToken", "tok-1", 3600);
    seed.set("emporix.cartId", "cart-1", 3600);
    await seed.flush();

    const { emporixSession } = await import("../src/server-session");
    const session = await emporixSession({ store });
    expect(session.customerToken).toBe("tok-1");
    expect(session.cartId).toBe("cart-1");
  });

  it("withEmporixSession resolves a customer context from the store", async () => {
    const store = fakeStore();
    const seed = await emporixSessionHandle({ store });
    seed.set("emporix.customerToken", "tok-1", 3600);
    await seed.flush();

    process.env.EMPORIX_TENANT = "viu";
    process.env.EMPORIX_STOREFRONT_CLIENT_ID = "sf";
    const { withEmporixSession } = await import("../src/session-client");
    const ctx = await withEmporixSession(async (_c, c) => c, { store });
    expect(ctx).toEqual({ kind: "customer", token: "tok-1" });
    delete process.env.EMPORIX_TENANT;
    delete process.env.EMPORIX_STOREFRONT_CLIENT_ID;
  });
});

describe("one handle per request", () => {
  it("hands the callback the handle it flushes", async () => {
    // Found live: the example built its OWN handle inside the callback, set a value
    // on it, and never flushed — in cookie mode `set` wrote through, in store
    // mode the value vanished. A second handle also mints a second session id and
    // clobbers the sid cookie. The callback gets the real one so neither
    // happens.
    const store = fakeStore();
    process.env.EMPORIX_TENANT = "viu";
    process.env.EMPORIX_STOREFRONT_CLIENT_ID = "sf";
    const { withEmporixSessionMutable } = await import("../src/session-client");
    await withEmporixSessionMutable(async (_client, _ctx, handle) => {
      handle.set("emporix.cartId", "cart-42", 3600);
    }, { store });
    delete process.env.EMPORIX_TENANT;
    delete process.env.EMPORIX_STOREFRONT_CLIENT_ID;

    expect(store.records.size).toBe(1);
    const [entry] = [...store.records.values()];
    expect(entry?.record["emporix.cartId"]).toBe("cart-42");
  });
});

describe("the deprecated sessionCookieJar alias", () => {
  /**
   * Pinned so removing it in 0.6.0 is a deliberate act with a red test, not a
   * silent break for anyone still on the old import. Identity, not behaviour:
   * if it is the same function object there is nothing else to verify.
   */
  it("is the same function as emporixSessionHandle", async () => {
    const mod = await import("../src/session-cookies");
    expect(mod.sessionCookieJar).toBe(mod.emporixSessionHandle);
  });

  it("is re-exported from the /session entry under both names", async () => {
    const entry = await import("../src/session");
    expect(entry.sessionCookieJar).toBe(entry.emporixSessionHandle);
  });
});
