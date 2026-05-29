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

describe("AvailabilityService.getMany", () => {
  it("POSTs the id array to /search with site + pageSize and preserves input order", async () => {
    let body: unknown = null;
    let query: URLSearchParams | null = null;
    server.use(
      http.post("https://api.emporix.io/availability/acme/availability/search", async ({ request }) => {
        body = await request.json();
        query = new URL(request.url).searchParams;
        // Returned out of order on purpose:
        return HttpResponse.json([
          { id: "main:p3", productId: "p3", site: "main", available: true },
          { id: "main:p1", productId: "p1", site: "main", available: true, stockLevel: 2 },
        ]);
      }),
    );
    const r = await svc().getMany(["p1", "p2", "p3"], "main");
    expect(body).toEqual(["p1", "p2", "p3"]);
    expect((query as URLSearchParams | null)?.get("site")).toBe("main");
    expect((query as URLSearchParams | null)?.get("pageSize")).toBe("3");
    expect(r.map((a) => a.productId)).toEqual(["p1", "p2", "p3"]); // input order
    expect(r[0]?.stockLevel).toBe(2);
    expect(r[1]).toEqual({ productId: "p2", site: "main", available: false }); // missing → unavailable
  });

  it("marks missing products available when defaultAvailableOnNotFound is set", async () => {
    server.use(
      http.post("https://api.emporix.io/availability/acme/availability/search", () =>
        HttpResponse.json([{ id: "main:p1", productId: "p1", site: "main", available: true }]),
      ),
    );
    const r = await svc().getMany(["p1", "p2"], "main", undefined, { defaultAvailableOnNotFound: true });
    expect(r[1]).toEqual({ productId: "p2", site: "main", available: true });
  });

  it("returns [] without making a request for an empty id list", async () => {
    let called = false;
    server.use(
      http.post("https://api.emporix.io/availability/acme/availability/search", () => {
        called = true;
        return HttpResponse.json([]);
      }),
    );
    const r = await svc().getMany([], "main");
    expect(r).toEqual([]);
    expect(called).toBe(false);
  });
});
