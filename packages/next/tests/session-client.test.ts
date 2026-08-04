import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { randomBytes } from "node:crypto";

/** Next's cookies() shape, enough of it to drive the code under test. */
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

const { withEmporixSession, withEmporixSessionMutable } = await import("../src/session-client");
const { __resetEmporixClients } = await import("../src/client");

function stubFetch(): { tokenCalls: () => number } {
  let tokenCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/customerlogin/auth/anonymous/")) {
        tokenCalls += 1;
        // Emporix mixes casing here and the SDK mirrors it: `sessionId` is
        // camelCase while the rest is snake_case — see core/auth.ts:372. A stub
        // that guesses `session_id` silently yields a session without an id.
        return new Response(
          JSON.stringify({
            access_token: "anon-access",
            refresh_token: "anon-refresh",
            sessionId: "sess-1",
            expires_in: 3600,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return { tokenCalls: () => tokenCalls };
}

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

describe("withEmporixSession — customer path", () => {
  it("uses a customer auth context when the token cookie is present", async () => {
    stubFetch();
    bag.set("emporix.customerToken", { name: "emporix.customerToken", value: "cust-tok" });
    const seen = await withEmporixSession(async (_c, ctx) => ctx);
    expect(seen).toEqual({ kind: "customer", token: "cust-tok" });
  });

  it("reuses the memoized client for the customer path", async () => {
    stubFetch();
    bag.set("emporix.customerToken", { name: "emporix.customerToken", value: "cust-tok" });
    const a = await withEmporixSession(async (c) => c);
    const b = await withEmporixSession(async (c) => c);
    expect(a).toBe(b);
  });

  it("never tags the customer client", async () => {
    stubFetch();
    bag.set("emporix.customerToken", { name: "emporix.customerToken", value: "cust-tok" });
    const client = await withEmporixSession(async (c) => c);
    expect(client.config.fetch).toBeUndefined();
  });
});

describe("withEmporixSession — guest path", () => {
  it("uses an anonymous auth context when no customer token is present", async () => {
    stubFetch();
    const seen = await withEmporixSession(async (_c, ctx) => ctx);
    expect(seen).toEqual({ kind: "anonymous" });
  });

  it("builds a DIFFERENT client per call, so guest sessions cannot be shared", async () => {
    // The core of the session-binding constraint: Emporix maps the anonymous
    // session-id onto the cart, so two guests must never share a client.
    stubFetch();
    const a = await withEmporixSession(async (c) => c);
    const b = await withEmporixSession(async (c) => c);
    expect(a).not.toBe(b);
  });

  it("never tags the guest client", async () => {
    stubFetch();
    const client = await withEmporixSession(async (c) => c);
    expect(client.config.fetch).toBeUndefined();
  });

  it("seeds the anonymous session from the cookie", async () => {
    const f = stubFetch();
    bag.set("emporix.anonymousSession", {
      name: "emporix.anonymousSession",
      value: JSON.stringify({ refreshToken: "r1", sessionId: "sess-9" }),
    });
    await withEmporixSessionMutable(async (client, ctx) => {
      await client.products.get("p1", undefined, ctx);
    });
    expect(f.tokenCalls()).toBeGreaterThan(0);
  });
});

describe("withEmporixSession — cookie writes", () => {
  it("persists a rotated anonymous session in the mutable variant", async () => {
    stubFetch();
    await withEmporixSessionMutable(async (client, ctx) => {
      await client.products.get("p1", undefined, ctx);
    });
    const written = bag.get("emporix.anonymousSession");
    expect(written).toBeDefined();
    expect(JSON.parse(written?.value ?? "{}")).toMatchObject({ sessionId: "sess-1" });
  });

  it("writes the anonymous cookie httpOnly with a bounded maxAge", async () => {
    stubFetch();
    await withEmporixSessionMutable(async (client, ctx) => {
      await client.products.get("p1", undefined, ctx);
    });
    const opts = bag.get("emporix.anonymousSession")?.opts ?? {};
    expect(opts).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(typeof opts.maxAge).toBe("number");
  });

  it("does NOT write cookies in the read-only variant", async () => {
    // A Server Component render must not write. Silently ignoring beats
    // throwing inside a render.
    stubFetch();
    await withEmporixSession(async (client, ctx) => {
      await client.products.get("p1", undefined, ctx);
    });
    expect(bag.get("emporix.anonymousSession")).toBeUndefined();
  });

  it("marks cookies Secure behind an https forwarded proto", async () => {
    stubFetch();
    headerBag.set("x-forwarded-proto", "https");
    await withEmporixSessionMutable(async (client, ctx) => {
      await client.products.get("p1", undefined, ctx);
    });
    // Prefixed, because __Host- rides on the same `secure` derivation.
    expect(bag.get("__Host-emporix.anonymousSession")?.opts).toMatchObject({ secure: true });
  });

  it("does not mark cookies Secure over plain http outside production", async () => {
    // Hard-coding secure:true drops the cookie on an http staging host — F-05.
    stubFetch();
    headerBag.set("x-forwarded-proto", "http");
    await withEmporixSessionMutable(async (client, ctx) => {
      await client.products.get("p1", undefined, ctx);
    });
    expect(bag.get("emporix.anonymousSession")?.opts).toMatchObject({ secure: false });
  });
});

describe("the server-only guard", () => {
  it("throws when the guard file is loaded, naming the way out", async () => {
    // Mirrors the service guard's test, including its lesson: neither pattern
    // may contain "server-only", because a MISSING file produces "Failed to
    // load url ../session-is-server-only.js" — which matches that, and would
    // make the assertion vacuous.
    // @ts-expect-error — untyped guard module, on purpose
    await expect(import("../session-is-server-only.js")).rejects.toThrow(
      /reads and writes session cookies/,
    );
    // @ts-expect-error — untyped guard module, on purpose
    await expect(import("../session-is-server-only.js")).rejects.toThrow(/use client/);
  });

  it("wires the export condition and ships the guard file", async () => {
    // Catches what is otherwise only visible on publish: without the files
    // entry the guard is absent from the tarball and `default` resolves to
    // nothing.
    const pkg = (await import("../package.json")) as unknown as {
      default: { exports: Record<string, unknown>; files: string[] };
    };
    const session = pkg.default.exports["./session"] as Record<string, unknown>;
    expect(session).toBeDefined();
    // `types` sits OUTSIDE the conditions. TypeScript does not understand
    // `react-server`, falls through to `default`, and would report
    // "File 'session-is-server-only.js' is not a module" even in a legitimate
    // Route Handler.
    expect(session["types"]).toBe("./dist/session.d.ts");
    expect(session["react-server"]).toMatchObject({
      import: "./dist/session.js",
      require: "./dist/session.cjs",
    });
    expect(session["default"]).toBe("./session-is-server-only.js");
    expect(pkg.default.files).toContain("session-is-server-only.js");
  });

  it("no longer exposes the old /bff subpath", async () => {
    // The rename must not leave both paths alive — two names for one entry is
    // the problem it was meant to remove.
    const pkg = (await import("../package.json")) as unknown as {
      default: { exports: Record<string, unknown> };
    };
    expect(pkg.default.exports["./bff"]).toBeUndefined();
  });
});

describe("cookie hardening", () => {
  afterEach(() => {
    delete process.env.EMPORIX_COOKIE_SECRET;
  });

  it("stores plaintext when no secret is configured", async () => {
    stubFetch();
    await withEmporixSessionMutable(async (client, ctx) => {
      await client.products.get("p1", undefined, ctx);
    });
    expect(bag.get("emporix.anonymousSession")?.value).toContain("sess-1");
  });

  it("stores ciphertext when a secret is configured", async () => {
    process.env.EMPORIX_COOKIE_SECRET = randomBytes(32).toString("base64url");
    stubFetch();
    await withEmporixSessionMutable(async (client, ctx) => {
      await client.products.get("p1", undefined, ctx);
    });
    const written = bag.get("emporix.anonymousSession")?.value;
    expect(written).toMatch(/^v1\./);
    expect(written).not.toContain("sess-1");
  });

  it("reads back what it sealed", async () => {
    process.env.EMPORIX_COOKIE_SECRET = randomBytes(32).toString("base64url");
    stubFetch();
    await withEmporixSessionMutable(async (client, ctx) => {
      await client.products.get("p1", undefined, ctx);
    });
    // The guest session survives the round trip: no second anonymous login.
    const before = bag.get("emporix.anonymousSession")?.value;
    await withEmporixSession(async (_c, ctx) => ctx);
    expect(bag.get("emporix.anonymousSession")?.value).toBe(before);
  });

  it("treats a cookie sealed with a retired key as absent", async () => {
    // The mass-logout lever: rotating the key out must log the guest out, not
    // throw a 500 at them.
    process.env.EMPORIX_COOKIE_SECRET = randomBytes(32).toString("base64url");
    stubFetch();
    await withEmporixSessionMutable(async (client, ctx) => {
      await client.products.get("p1", undefined, ctx);
    });
    process.env.EMPORIX_COOKIE_SECRET = randomBytes(32).toString("base64url");
    const seen = await withEmporixSession(async (_c, ctx) => ctx);
    expect(seen).toEqual({ kind: "anonymous" });
  });

  it("drops the __Host- prefix over plain http", async () => {
    // A browser refuses __Host- without Secure, so a local http host must not
    // get the prefix — same reason `secure` is derived rather than hard-coded.
    stubFetch();
    headerBag.set("x-forwarded-proto", "http");
    await withEmporixSessionMutable(async (client, ctx) => {
      await client.products.get("p1", undefined, ctx);
    });
    expect(bag.get("emporix.anonymousSession")).toBeDefined();
    expect(bag.get("__Host-emporix.anonymousSession")).toBeUndefined();
  });

  it("reads a cookie written before the prefix existed", async () => {
    // Prefixed-first with a bare fallback, so an upgrade does not log out
    // sessions that predate it.
    stubFetch();
    headerBag.set("x-forwarded-proto", "https");
    bag.set("emporix.customerToken", { name: "emporix.customerToken", value: "legacy-tok" });
    const seen = await withEmporixSession(async (_c, ctx) => ctx);
    expect(seen).toEqual({ kind: "customer", token: "legacy-tok" });
  });
});
