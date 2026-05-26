import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { CustomerService } from "../../src/services/customer";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";
import { EmporixAuthError } from "../../src/core/errors";

const SESSION = "sess-1";
const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon-tok", token_type: "Bearer", expires_in: 3599,
      refresh_token: "anon-rt", sessionId: SESSION, scope: "tenant=acme",
    }),
  ),
  http.post("https://api.emporix.io/customer/acme/login", async ({ request }) => {
    expect(request.headers.get("authorization")).toBe("Bearer anon-tok");
    const body = (await request.json()) as { email: string };
    expect(body.email).toBe("a@b.co");
    // Real Emporix response is snake_case (camelCase fields are deprecated).
    return HttpResponse.json({
      access_token: "cust-tok",
      saas_token: "saas-tok",
      refresh_token: "cust-rt",
      expires_in: 2591999,
      token_type: "Bearer",
      session_id: "sess-1",
      initialPassword: false,
    });
  }),
  http.get("https://api.emporix.io/customer/acme/me", ({ request }) => {
    expect(request.headers.get("authorization")).toBe("Bearer cust-tok");
    return HttpResponse.json({
      id: "c1",
      contactEmail: "a@b.co",
      firstName: "A",
      preferredLanguage: "en",
    });
  }),
  http.get("https://api.emporix.io/customer/acme/me/addresses", () =>
    HttpResponse.json([{ id: "ad1", city: "Berlin" }]),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function svc() {
  const cfg = {
    tenant: "acme",
    host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "customer" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new CustomerService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

describe("CustomerService", () => {
  it("anonymous() returns the full session including sessionId", async () => {
    const s = await svc().anonymous();
    expect(s.accessToken).toBe("anon-tok");
    expect(s.sessionId).toBe(SESSION);
    expect(s.refreshToken).toBe("anon-rt");
  });

  it("login() maps the snake_case wire response and exposes saasToken/sessionId", async () => {
    const r = await svc().login({ email: "a@b.co", password: "p" });
    expect(r.customerToken).toBe("cust-tok");
    expect(r.saasToken).toBe("saas-tok"); // required for checkout (saas-token header)
    expect(r.refreshToken).toBe("cust-rt");
    expect(r.sessionId).toBe("sess-1");
  });

  it("login() falls back to deprecated camelCase fields when that's all that's returned", async () => {
    server.use(
      http.post("https://api.emporix.io/customer/acme/login", () =>
        HttpResponse.json({ accessToken: "c2", saasToken: "s2", refreshToken: "r2" }),
      ),
    );
    const r = await svc().login({ email: "a@b.co", password: "p" });
    expect(r.customerToken).toBe("c2");
    expect(r.saasToken).toBe("s2");
    expect(r.refreshToken).toBe("r2");
    expect(r.sessionId).toBeUndefined();
  });

  it("me() requires a customer/raw context", async () => {
    const s = svc();
    await expect(s.me()).rejects.toBeInstanceOf(EmporixAuthError);
    const me = await s.me({ kind: "customer", token: "cust-tok" });
    expect(me.contactEmail).toBe("a@b.co");
    // Field the old hand-rolled Customer interface dropped — now typed.
    expect(me.preferredLanguage).toBe("en");
  });

  it("addresses.list() requires a customer/raw context and returns typed rows", async () => {
    const s = svc();
    await expect(s.addresses.list()).rejects.toBeInstanceOf(EmporixAuthError);
    const rows = await s.addresses.list({ kind: "customer", token: "cust-tok" });
    expect(rows[0]?.city).toBe("Berlin");
  });

  it("logout() requires customer/raw and GETs /logout?accessToken with the customer bearer", async () => {
    let seen: { auth: string | null; accessToken: string | null } | null = null;
    server.use(
      http.get("https://api.emporix.io/customer/acme/logout", ({ request }) => {
        seen = {
          auth: request.headers.get("authorization"),
          accessToken: new URL(request.url).searchParams.get("accessToken"),
        };
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const s = svc();
    await expect(s.logout()).rejects.toBeInstanceOf(EmporixAuthError);
    await expect(
      s.logout({ kind: "customer", token: "cust-tok" }),
    ).resolves.toBeUndefined();
    expect(seen).toEqual({ auth: "Bearer cust-tok", accessToken: "cust-tok" });
  });

  it("refresh() sends the refreshToken query with an anonymous token, maps snake_case, carries saasToken", async () => {
    server.use(
      http.get("https://api.emporix.io/customer/acme/refreshauthtoken", ({ request }) => {
        expect(request.headers.get("authorization")).toBe("Bearer anon-tok");
        const u = new URL(request.url);
        expect(u.searchParams.get("refreshToken")).toBe("cust-rt");
        expect(u.searchParams.get("legalEntityId")).toBe("le-1");
        return HttpResponse.json({
          access_token: "cust-tok-2",
          refresh_token: "cust-rt-2",
          refresh_token_expires_in: 2591999,
          expires_in: 3600,
          token_type: "Bearer",
          session_id: "sess-1",
        });
      }),
    );
    const r = await svc().refresh({
      refreshToken: "cust-rt",
      saasToken: "saas-tok",
      legalEntityId: "le-1",
    });
    expect(r.customerToken).toBe("cust-tok-2");
    expect(r.refreshToken).toBe("cust-rt-2");
    expect(r.sessionId).toBe("sess-1");
    expect(r.expiresIn).toBe(3600);
    // The refresh endpoint does NOT return a saas_token — it is carried over.
    expect(r.saasToken).toBe("saas-tok");
  });

  it("socialLogin() exchanges the code with an anonymous token, maps snake_case + social tokens, normalizes string expires_in", async () => {
    let seen: { auth: string | null; url: string; sessionHeader: string | null } | null = null;
    server.use(
      http.post("https://api.emporix.io/customer/acme/socialLogin", ({ request }) => {
        seen = {
          auth: request.headers.get("authorization"),
          url: request.url,
          sessionHeader: request.headers.get("session-id"),
        };
        return HttpResponse.json({
          social_access_token: "idp-at",
          social_id_token: "idp-it",
          access_token: "cust-tok",
          saas_token: "saas-tok",
          refresh_token: "cust-rt",
          refresh_token_expires_in: "86399",
          token_type: "Bearer",
          expires_in: "14399",
          scope: "tenant=acme",
        });
      }),
    );
    const r = await svc().socialLogin({
      code: "auth-code",
      redirectUri: "https://shop/cb",
      codeVerifier: "verif",
      sessionId: "sess-1",
    });
    const u = new URL(seen!.url);
    expect(seen!.auth).toBe("Bearer anon-tok");
    expect(seen!.sessionHeader).toBe("sess-1");
    expect(u.searchParams.get("code")).toBe("auth-code");
    expect(u.searchParams.get("redirect_uri")).toBe("https://shop/cb");
    expect(u.searchParams.get("code_verifier")).toBe("verif");
    expect(r.customerToken).toBe("cust-tok");
    expect(r.saasToken).toBe("saas-tok");
    expect(r.refreshToken).toBe("cust-rt");
    expect(r.socialAccessToken).toBe("idp-at");
    expect(r.socialIdToken).toBe("idp-it");
    expect(r.expiresIn).toBe(14399); // string "14399" → number
    expect(r.sessionId).toBeUndefined(); // socialLogin response has no session_id
  });

  it("socialLogin() omits code_verifier and the session-id header when not provided", async () => {
    let seen: { url: string; sessionHeader: string | null } | null = null;
    server.use(
      http.post("https://api.emporix.io/customer/acme/socialLogin", ({ request }) => {
        seen = { url: request.url, sessionHeader: request.headers.get("session-id") };
        return HttpResponse.json({ access_token: "c", saas_token: "s", refresh_token: "r" });
      }),
    );
    await svc().socialLogin({ code: "c1", redirectUri: "https://shop/cb" });
    const u = new URL(seen!.url);
    expect(u.searchParams.has("code_verifier")).toBe(false);
    expect(seen!.sessionHeader).toBeNull();
  });

  it("exchangeToken() posts subjectAccessToken + config with an anonymous token, maps snake_case, integer expires_in", async () => {
    let seen: { auth: string | null; url: string } | null = null;
    server.use(
      http.post("https://api.emporix.io/customer/acme/exchangeauthtoken", ({ request }) => {
        seen = { auth: request.headers.get("authorization"), url: request.url };
        return HttpResponse.json({
          subject_access_token: "idp-jwt",
          access_token: "cust-tok",
          saas_token: "saas-tok",
          refresh_token: "cust-rt",
          refresh_token_expires_in: 86399,
          token_type: "Bearer",
          expires_in: 14399,
          scope: "tenant=acme",
          session_id: "sess-9",
        });
      }),
    );
    const r = await svc().exchangeToken({ subjectToken: "idp-jwt", config: "Site_DE" });
    const u = new URL(seen!.url);
    expect(seen!.auth).toBe("Bearer anon-tok");
    expect(u.searchParams.get("subjectAccessToken")).toBe("idp-jwt");
    expect(u.searchParams.get("config")).toBe("Site_DE");
    expect(r.customerToken).toBe("cust-tok");
    expect(r.saasToken).toBe("saas-tok");
    expect(r.refreshToken).toBe("cust-rt");
    expect(r.sessionId).toBe("sess-9");
    expect(r.expiresIn).toBe(14399); // integer passes through Number() unchanged
    expect(r.socialAccessToken).toBeUndefined();
  });

  it("exchangeToken() omits config when not provided", async () => {
    let url = "";
    server.use(
      http.post("https://api.emporix.io/customer/acme/exchangeauthtoken", ({ request }) => {
        url = request.url;
        return HttpResponse.json({ access_token: "c", saas_token: "s", refresh_token: "r" });
      }),
    );
    await svc().exchangeToken({ subjectToken: "jwt" });
    expect(new URL(url).searchParams.has("config")).toBe(false);
  });
});

describe("CustomerService.refresh with legalEntityId", () => {
  it("forwards legalEntityId as a query param", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.get("https://api.emporix.io/customer/acme/refreshauthtoken", ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json({ access_token: "new-tok", refresh_token: "new-r" });
      }),
    );
    await svc().refresh({ refreshToken: "old-r", legalEntityId: "le-1" });
    expect((q as URLSearchParams | null)?.get("refreshToken")).toBe("old-r");
    expect((q as URLSearchParams | null)?.get("legalEntityId")).toBe("le-1");
  });

  it("omits legalEntityId when not provided", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.get("https://api.emporix.io/customer/acme/refreshauthtoken", ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json({ access_token: "new-tok", refresh_token: "new-r" });
      }),
    );
    await svc().refresh({ refreshToken: "old-r" });
    expect((q as URLSearchParams | null)?.has("legalEntityId")).toBe(false);
  });
});
