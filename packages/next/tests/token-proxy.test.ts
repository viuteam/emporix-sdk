import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

const SITE = "emporix.siteCode";
const TOKEN = "emporix.customerToken";
const EXPIRES = "emporix.customerTokenExpiresAt";

/**
 * The Emporix customer access token is OPAQUE — not a JWT. An earlier version of
 * these tests built a synthetic JWT and read its `exp`, which passed while the
 * implementation refreshed on every real request. The expiry now comes from a
 * cookie written at login/refresh time, so the tests use one too.
 */
const OPAQUE = "R1BGrWLCWd2FgILsGizHi7iSe613";

function expiresIn(seconds: number): string {
  return String(Math.floor(Date.now() / 1000) + seconds);
}

const refreshCalls: number[] = [];
vi.mock("../src/session-auth", () => ({
  emporixRefresh: vi.fn(async () => {
    refreshCalls.push(1);
    return "fresh-token";
  }),
  emporixLogin: vi.fn(),
  emporixLogout: vi.fn(),
  assertSameOrigin: vi.fn(),
}));

const { emporixTokenProxy } = await import("../src/token-proxy");

beforeEach(() => {
  refreshCalls.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("emporixTokenProxy", () => {
  it("refreshes when the stored expiry is inside the skew window", async () => {
    const request = new NextRequest("https://shop.test/", {
      headers: { cookie: `${TOKEN}=${OPAQUE}; ${EXPIRES}=${expiresIn(30)}` },
    });
    await emporixTokenProxy(request);
    expect(refreshCalls).toHaveLength(1);
  });

  it("leaves a comfortably fresh token alone", async () => {
    // The regression that mattered: with an opaque token and a valid expiry,
    // nothing should happen. The old implementation refreshed here every time.
    const request = new NextRequest("https://shop.test/", {
      headers: { cookie: `${TOKEN}=${OPAQUE}; ${EXPIRES}=${expiresIn(3600)}` },
    });
    await emporixTokenProxy(request);
    expect(refreshCalls).toHaveLength(0);
  });

  it("does not refresh a fresh token across repeated requests", async () => {
    // Ten page views must not produce ten refreshes.
    const cookie = `${TOKEN}=${OPAQUE}; ${EXPIRES}=${expiresIn(3600)}`;
    for (let i = 0; i < 10; i += 1) {
      await emporixTokenProxy(new NextRequest("https://shop.test/", { headers: { cookie } }));
    }
    expect(refreshCalls).toHaveLength(0);
  });

  it("does not refresh when there is no token cookie", async () => {
    const request = new NextRequest("https://shop.test/");
    await emporixTokenProxy(request);
    expect(refreshCalls).toHaveLength(0);
  });

  it("refreshes once when the expiry cookie is missing, then self-heals", async () => {
    // A token without a stored expiry cannot be judged, so refresh — which
    // writes the expiry, so the next request has one.
    const request = new NextRequest("https://shop.test/", {
      headers: { cookie: `${TOKEN}=${OPAQUE}` },
    });
    await emporixTokenProxy(request);
    expect(refreshCalls).toHaveLength(1);
  });

  it("treats an unparseable expiry as missing", async () => {
    const request = new NextRequest("https://shop.test/", {
      headers: { cookie: `${TOKEN}=${OPAQUE}; ${EXPIRES}=not-a-number` },
    });
    await emporixTokenProxy(request);
    expect(refreshCalls).toHaveLength(1);
  });

  it("honours a custom skew window", async () => {
    const request = new NextRequest("https://shop.test/", {
      headers: { cookie: `${TOKEN}=${OPAQUE}; ${EXPIRES}=${expiresIn(300)}` },
    });
    await emporixTokenProxy(request, { skewSeconds: 600 });
    expect(refreshCalls).toHaveLength(1);
  });

  it("injects the refreshed token into the forwarded request cookies", async () => {
    const request = new NextRequest("https://shop.test/", {
      headers: { cookie: `${TOKEN}=${OPAQUE}; ${EXPIRES}=${expiresIn(30)}` },
    });
    await emporixTokenProxy(request);
    expect(request.headers.get("cookie")).toContain(`${TOKEN}=fresh-token`);
  });

  it("delegates site and language to emporixSiteProxy", async () => {
    const request = new NextRequest("https://shop.test/");
    const response = await emporixTokenProxy(request, { site: { siteCode: "main" } });
    expect(response.cookies.get(SITE)?.value).toBe("main");
  });

  it("writes no cookies at all when there is nothing to do", async () => {
    const request = new NextRequest("https://shop.test/");
    const response = await emporixTokenProxy(request);
    expect(response.cookies.getAll()).toHaveLength(0);
  });

  it("passes rewriteTo through to emporixSiteProxy", async () => {
    const request = new NextRequest("https://shop.test/de/shoes");
    const response = await emporixTokenProxy(request, {
      site: { language: "de" },
      rewriteTo: "/shoes",
    });
    expect(response.headers.get("x-middleware-rewrite")).toBe("https://shop.test/shoes");
  });
});
