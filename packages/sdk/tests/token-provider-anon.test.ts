import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse, delay } from "msw";
import { DefaultTokenProvider } from "../src/core/auth";
import { EmporixTimeoutError } from "../src/core/errors";

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

  it("times out a hung anonymous login instead of blocking forever", async () => {
    server.use(
      http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", async () => {
        await delay(2_000);
        return HttpResponse.json({
          access_token: "late", token_type: "Bearer",
          expires_in: 3599, refresh_token: "rt-1", sessionId: SESSION,
        });
      }),
    );
    const p = new DefaultTokenProvider({
      ...cfg,
      timeouts: { connectMs: 50, readMs: 50 },
    } as never);
    await expect(p.getAnonymousToken()).rejects.toBeInstanceOf(EmporixTimeoutError);
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

describe("anonymous token expiry → refresh (sessionId preserved)", () => {
  // Login handler whose token is already expired (expires_in below the
  // 60s buffer ⇒ expiresAt in the past ⇒ immediately stale).
  const expiredLogin = () =>
    http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () => {
      loginHits += 1;
      return HttpResponse.json({
        access_token: `anon-${loginHits}`, token_type: "Bearer",
        expires_in: 0, refresh_token: "rt-1", sessionId: SESSION,
      });
    });

  it("refreshes via the refresh token instead of a new login, keeping sessionId", async () => {
    server.use(expiredLogin());
    const p = new DefaultTokenProvider(cfg as never);
    const s1 = await p.getAnonymousToken(); // login (stale immediately)
    const s2 = await p.getAnonymousToken(); // expired ⇒ refresh, not login
    expect(s1.accessToken).toBe("anon-1");
    expect(s2.accessToken).toBe("anon-r1");
    expect(s2.sessionId).toBe(SESSION);
    expect(loginHits).toBe(1);
    expect(refreshHits).toBe(1);
  });

  it("falls back to a fresh login when the refresh fails", async () => {
    server.use(
      expiredLogin(),
      http.get("https://api.emporix.io/customerlogin/auth/anonymous/refresh", () => {
        refreshHits += 1;
        return HttpResponse.json({ message: "expired refresh token" }, { status: 401 });
      }),
    );
    const p = new DefaultTokenProvider(cfg as never);
    await p.getAnonymousToken(); // login anon-1
    const s2 = await p.getAnonymousToken(); // refresh attempted (401) ⇒ fallback login anon-2
    expect(s2.accessToken).toBe("anon-2");
    expect(loginHits).toBe(2);
    expect(refreshHits).toBe(1);
  });

  it("expireAnonymous() keeps the refresh token so the next call refreshes", async () => {
    const p = new DefaultTokenProvider(cfg as never);
    await p.getAnonymousToken(); // fresh login anon-1 (default handler, valid)
    p.expireAnonymous();
    const s = await p.getAnonymousToken(); // not fresh, anon kept ⇒ refresh
    expect(s.accessToken).toBe("anon-r1");
    expect(s.sessionId).toBe(SESSION);
    expect(loginHits).toBe(1);
    expect(refreshHits).toBe(1);
  });
});

describe("DefaultTokenProvider with AnonymousSessionStore", () => {
  it("bootstraps from store.read() and uses refresh mode on first call", async () => {
    const reads: number[] = [];
    const writes: Array<{ refreshToken: string; sessionId: string } | null> = [];
    const store = {
      read: () => {
        reads.push(Date.now());
        return { refreshToken: "rt-1", sessionId: SESSION };
      },
      write: (s: { refreshToken: string; sessionId: string } | null) => {
        writes.push(s);
      },
    };
    const p = new DefaultTokenProvider(cfg as never);
    p.attachAnonymousStore!(store);

    const sess = await p.getAnonymousToken();

    expect(sess.sessionId).toBe(SESSION);
    expect(sess.accessToken).toBe("anon-r1");
    expect(reads.length).toBe(1);
    // No login should have happened — refresh used the persisted refresh-token.
    expect(loginHits).toBe(0);
    expect(refreshHits).toBe(1);
    expect(writes.at(-1)).toEqual({ refreshToken: "rt-1", sessionId: SESSION });
  });

  it("falls back to login when store.read() returns null and writes the new session", async () => {
    const writes: Array<{ refreshToken: string; sessionId: string } | null> = [];
    const store = {
      read: () => null,
      write: (s: { refreshToken: string; sessionId: string } | null) => {
        writes.push(s);
      },
    };
    const p = new DefaultTokenProvider(cfg as never);
    p.attachAnonymousStore!(store);

    await p.getAnonymousToken();

    expect(loginHits).toBe(1);
    expect(writes.at(-1)).toEqual({ refreshToken: "rt-1", sessionId: SESSION });
  });

  it("invalidateAnonymous clears the store", async () => {
    const writes: Array<{ refreshToken: string; sessionId: string } | null> = [];
    const store = {
      read: () => null,
      write: (s: { refreshToken: string; sessionId: string } | null) => {
        writes.push(s);
      },
    };
    const p = new DefaultTokenProvider(cfg as never);
    p.attachAnonymousStore!(store);
    await p.getAnonymousToken();
    p.invalidateAnonymous();
    expect(writes.at(-1)).toBe(null);
  });

  it("behaves identically to today when no store is attached", async () => {
    const p = new DefaultTokenProvider(cfg as never);
    // No attachAnonymousStore call.
    const sess = await p.getAnonymousToken();
    expect(sess.accessToken).toBe("anon-1");
    expect(loginHits).toBe(1);
  });
});

describe("DefaultTokenProvider.onRefresh", () => {
  it("notifies subscribers on anonymous-login with success=true", async () => {
    const events: { kind: "anonymous" | "customer"; success: boolean }[] = [];
    const p = new DefaultTokenProvider(cfg as never);
    p.onRefresh!((e) => events.push(e));
    await p.getAnonymousToken();
    expect(events).toEqual([{ kind: "anonymous", success: true }]);
  });

  it("notifies with success=false when the request fails", async () => {
    server.use(
      http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
        HttpResponse.json({ message: "boom" }, { status: 500 }),
      ),
    );
    const events: { kind: "anonymous" | "customer"; success: boolean }[] = [];
    const p = new DefaultTokenProvider(cfg as never);
    p.onRefresh!((e) => events.push(e));
    await expect(p.getAnonymousToken()).rejects.toThrow();
    expect(events).toEqual([{ kind: "anonymous", success: false }]);
  });

  it("unsubscribe stops further notifications", async () => {
    const events: unknown[] = [];
    const p = new DefaultTokenProvider(cfg as never);
    const unsubscribe = p.onRefresh!((e) => events.push(e));
    unsubscribe();
    await p.getAnonymousToken();
    expect(events).toEqual([]);
  });
});

describe("DefaultTokenProvider.setAnonymousContext", () => {
  it("overrides the login currency and forces a fresh login", async () => {
    let url = "";
    server.use(
      http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", ({ request }) => {
        url = request.url;
        loginHits += 1;
        return HttpResponse.json({
          access_token: `anon-${loginHits}`, token_type: "Bearer", expires_in: 3599,
          refresh_token: "rt", sessionId: "s",
        });
      }),
    );
    const ctxCfg = {
      ...cfg,
      credentials: { storefront: { clientId: "sf", context: { currency: "CHF", siteCode: "main" } } },
    };
    const p = new DefaultTokenProvider(ctxCfg as never);
    await p.getAnonymousToken();                  // login #1 (CHF)
    p.setAnonymousContext!({ currency: "USD" });  // override + invalidate
    await p.getAnonymousToken();                  // login #2 (USD)
    const u = new URL(url);
    expect(u.searchParams.get("currency")).toBe("USD");
    expect(u.searchParams.get("siteCode")).toBe("main"); // unrelated field preserved
    expect(loginHits).toBe(2);                    // invalidation forced a fresh login
  });
});
