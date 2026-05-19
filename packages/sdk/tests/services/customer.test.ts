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
});
