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
    return HttpResponse.json({
      accessToken: "cust-tok", saasToken: "saas-tok", refreshToken: "cust-rt",
    });
  }),
  http.get("https://api.emporix.io/customer/acme/me", ({ request }) => {
    expect(request.headers.get("authorization")).toBe("Bearer cust-tok");
    return HttpResponse.json({ id: "c1", email: "a@b.co", firstName: "A" });
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

  it("login() threads the anonymous token and maps accessToken→customerToken", async () => {
    const r = await svc().login({ email: "a@b.co", password: "p" });
    expect(r.customerToken).toBe("cust-tok");
    expect(r.saasToken).toBe("saas-tok");
    expect(r.refreshToken).toBe("cust-rt");
  });

  it("me() requires a customer/raw context", async () => {
    const s = svc();
    await expect(s.me()).rejects.toBeInstanceOf(EmporixAuthError);
    const me = await s.me({ kind: "customer", token: "cust-tok" });
    expect(me.email).toBe("a@b.co");
  });

  it("addresses.list() requires a customer/raw context and returns typed rows", async () => {
    const s = svc();
    await expect(s.addresses.list()).rejects.toBeInstanceOf(EmporixAuthError);
    const rows = await s.addresses.list({ kind: "customer", token: "cust-tok" });
    expect(rows[0]?.city).toBe("Berlin");
  });
});
