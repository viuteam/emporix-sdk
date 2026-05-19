import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { DefaultTokenProvider } from "../src/core/auth";

let loginHits = 0;
let refreshHits = 0;
const SESSION = "sess-123";
const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", ({ request }) => {
    const u = new URL(request.url);
    expect(u.searchParams.get("tenant")).toBe("acme");
    expect(u.searchParams.get("client_id")).toBe("sf");
    loginHits += 1;
    return HttpResponse.json({
      access_token: `anon-${loginHits}`, token_type: "Bearer",
      expires_in: 3599, refresh_token: "rt-1", sessionId: SESSION, scope: "tenant=acme",
    });
  }),
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/refresh", ({ request }) => {
    const u = new URL(request.url);
    expect(u.searchParams.get("refresh_token")).toBe("rt-1");
    refreshHits += 1;
    return HttpResponse.json({
      access_token: `anon-r${refreshHits}`, token_type: "Bearer",
      expires_in: 3599, refresh_token: "rt-1", sessionId: SESSION, scope: "tenant=acme",
    });
  }),
);
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  loginHits = 0;
  refreshHits = 0;
});
afterAll(() => server.close());

const cfg = {
  tenant: "acme",
  host: "https://api.emporix.io",
  credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
  cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
};

describe("DefaultTokenProvider anonymous path", () => {
  it("fetches an anonymous session and caches it", async () => {
    const p = new DefaultTokenProvider(cfg as never);
    const s1 = await p.getAnonymousToken();
    const s2 = await p.getAnonymousToken();
    expect(s1.accessToken).toBe("anon-1");
    expect(s2.accessToken).toBe("anon-1"); // cached
    expect(s1.sessionId).toBe(SESSION);
    expect(loginHits).toBe(1);
  });

  it("refresh preserves the same sessionId", async () => {
    const p = new DefaultTokenProvider(cfg as never);
    await p.getAnonymousToken();
    const refreshed = await p.refreshAnonymous();
    expect(refreshed.accessToken).toBe("anon-r1");
    expect(refreshed.sessionId).toBe(SESSION);
    expect(refreshHits).toBe(1);
  });

  it("invalidateAnonymous forces a fresh login", async () => {
    const p = new DefaultTokenProvider(cfg as never);
    await p.getAnonymousToken();
    p.invalidateAnonymous();
    expect((await p.getAnonymousToken()).accessToken).toBe("anon-2");
  });

  it("concurrent anonymous calls share one request", async () => {
    const p = new DefaultTokenProvider(cfg as never);
    await Promise.all([p.getAnonymousToken(), p.getAnonymousToken()]);
    expect(loginHits).toBe(1);
  });

  it("throws if storefront credentials are missing", async () => {
    const noSf = { ...cfg, credentials: { backend: cfg.credentials.backend } };
    const p = new DefaultTokenProvider(noSf as never);
    await expect(p.getAnonymousToken()).rejects.toThrow(/storefront/i);
  });
});

describe("anonymous-login session context", () => {
  it("sends currency/siteCode/targetLocation when configured", async () => {
    let url = "";
    server.use(
      http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", ({ request }) => {
        url = request.url;
        return HttpResponse.json({
          access_token: "a", token_type: "Bearer", expires_in: 3599,
          refresh_token: "rt", sessionId: "s",
        });
      }),
    );
    const ctxCfg = {
      ...cfg,
      credentials: {
        storefront: {
          clientId: "sf",
          context: { currency: "CHF", siteCode: "main", targetLocation: "CH" },
        },
      },
    };
    await new DefaultTokenProvider(ctxCfg as never).getAnonymousToken();
    const u = new URL(url);
    expect(u.searchParams.get("currency")).toBe("CHF");
    expect(u.searchParams.get("siteCode")).toBe("main");
    expect(u.searchParams.get("targetLocation")).toBe("CH");
  });

  it("omits context params when no context is configured", async () => {
    let url = "";
    server.use(
      http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", ({ request }) => {
        url = request.url;
        return HttpResponse.json({
          access_token: "a", token_type: "Bearer", expires_in: 3599,
          refresh_token: "rt", sessionId: "s",
        });
      }),
    );
    await new DefaultTokenProvider(cfg as never).getAnonymousToken();
    const u = new URL(url);
    expect(u.searchParams.has("currency")).toBe(false);
  });
});
