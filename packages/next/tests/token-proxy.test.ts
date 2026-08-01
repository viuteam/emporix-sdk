import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

const SITE = "emporix.siteCode";
const TOKEN = "emporix.customerToken";

/** A JWT with only the exp claim — the signature is never verified. */
function jwt(expSecondsFromNow: number): string {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expSecondsFromNow }),
  ).toString("base64url");
  return `header.${payload}.signature`;
}

const refreshCalls: number[] = [];
vi.mock("../src/bff-auth", () => ({
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
  it("refreshes when the access token is inside the skew window", async () => {
    const request = new NextRequest("https://shop.test/", {
      headers: { cookie: `${TOKEN}=${jwt(30)}` },
    });
    await emporixTokenProxy(request);
    expect(refreshCalls).toHaveLength(1);
  });

  it("leaves a comfortably fresh token alone", async () => {
    const request = new NextRequest("https://shop.test/", {
      headers: { cookie: `${TOKEN}=${jwt(3600)}` },
    });
    await emporixTokenProxy(request);
    expect(refreshCalls).toHaveLength(0);
  });

  it("does not refresh when there is no token cookie", async () => {
    const request = new NextRequest("https://shop.test/");
    await emporixTokenProxy(request);
    expect(refreshCalls).toHaveLength(0);
  });

  it("treats a malformed token as expired and refreshes", async () => {
    // Fail safe: the cost of being wrong is one unnecessary refresh.
    const request = new NextRequest("https://shop.test/", {
      headers: { cookie: `${TOKEN}=not-a-jwt` },
    });
    await emporixTokenProxy(request);
    expect(refreshCalls).toHaveLength(1);
  });

  it("honours a custom skew window", async () => {
    const request = new NextRequest("https://shop.test/", {
      headers: { cookie: `${TOKEN}=${jwt(300)}` },
    });
    await emporixTokenProxy(request, { skewSeconds: 600 });
    expect(refreshCalls).toHaveLength(1);
  });

  it("injects the refreshed token into the forwarded request cookies", async () => {
    const request = new NextRequest("https://shop.test/", {
      headers: { cookie: `${TOKEN}=${jwt(30)}` },
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
