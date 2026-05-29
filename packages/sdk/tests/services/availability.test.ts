import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { AvailabilityService } from "../../src/services/availability";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";
import { EmporixNotFoundError } from "../../src/core/errors";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon-tok", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
  http.post("https://api.emporix.io/oauth/token", () =>
    HttpResponse.json({ access_token: "svc-tok", token_type: "Bearer", expires_in: 3599 }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const SERVICE = { kind: "service" as const, credentials: "backend" };

function svc(): AvailabilityService {
  const cfg = {
    tenant: "acme", host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "availability" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io", provider: tokenProvider, logger,
    retry: { maxAttempts: 1 }, timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new AvailabilityService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

describe("AvailabilityService.get", () => {
  it("GETs the single endpoint with the anonymous token and returns the record", async () => {
    let authHeader: string | null = null;
    server.use(
      http.get("https://api.emporix.io/availability/acme/availability/p1/main", ({ request }) => {
        authHeader = request.headers.get("authorization");
        return HttpResponse.json({ id: "main:p1", productId: "p1", site: "main", available: true, stockLevel: 7 });
      }),
    );
    const r = await svc().get("p1", "main");
    expect(authHeader).toBe("Bearer anon-tok");
    expect(r.available).toBe(true);
    expect(r.stockLevel).toBe(7);
  });

  it("throws EmporixNotFoundError on 404 without defaultAvailableOnNotFound", async () => {
    server.use(
      http.get("https://api.emporix.io/availability/acme/availability/missing/main", () =>
        HttpResponse.json({ code: 404, message: "not found" }, { status: 404 }),
      ),
    );
    await expect(svc().get("missing", "main")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("returns a default available record on 404 when defaultAvailableOnNotFound is set", async () => {
    server.use(
      http.get("https://api.emporix.io/availability/acme/availability/missing/main", () =>
        HttpResponse.json({ code: 404, message: "not found" }, { status: 404 }),
      ),
    );
    const r = await svc().get("missing", "main", undefined, { defaultAvailableOnNotFound: true });
    expect(r).toEqual({ productId: "missing", site: "main", available: true });
  });

  it("re-auths and retries once on a 401 for a service AuthContext", async () => {
    let hits = 0;
    server.use(
      http.get("https://api.emporix.io/availability/acme/availability/p1/main", () => {
        hits += 1;
        if (hits === 1) return HttpResponse.json({ code: 401 }, { status: 401 });
        return HttpResponse.json({ id: "main:p1", productId: "p1", site: "main", available: true });
      }),
    );
    const r = await svc().get("p1", "main", SERVICE);
    expect(hits).toBe(2);
    expect(r.available).toBe(true);
  });
});
