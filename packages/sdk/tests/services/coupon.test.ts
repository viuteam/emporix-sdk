import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { CouponService } from "../../src/services/coupon";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { EmporixNotFoundError } from "../../src/core/errors";
import { MemoryLogger } from "../helpers/memory-logger";

const server = setupServer(
  http.post("https://api.emporix.io/oauth/token", () =>
    HttpResponse.json({ access_token: "svc-tok", token_type: "Bearer", expires_in: 3599 }),
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "coupon" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new CouponService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/coupon/acme";
const REDEMPTION = {
  orderCode: "O1",
  orderTotal: { amount: 100, currency: "EUR" },
  discount: { amount: 10, currency: "EUR" },
};

describe("CouponService", () => {
  it("listCoupons GETs the array with a service token", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(`${BASE}/coupons`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json([{ code: "SUMMER" }]);
      }),
    );
    const out = await svc().listCoupons();
    expect(seenAuth).toBe("Bearer svc-tok");
    expect(out).toEqual([{ code: "SUMMER" }]);
  });

  it("getCoupon fetches one by code", async () => {
    server.use(http.get(`${BASE}/coupons/SUMMER`, () => HttpResponse.json({ code: "SUMMER" })));
    expect((await svc().getCoupon("SUMMER")).code).toBe("SUMMER");
  });

  it("getCoupon throws EmporixNotFoundError on 404", async () => {
    server.use(
      http.get(`${BASE}/coupons/NOPE`, () =>
        HttpResponse.json({ status: 404, message: "x" }, { status: 404 }),
      ),
    );
    await expect(svc().getCoupon("NOPE")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("createCoupon POSTs the body and returns the resource location", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/coupons`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "SUMMER" }, { status: 201 });
      }),
    );
    const res = await svc().createCoupon({ code: "SUMMER", name: "Summer sale" });
    expect(body).toEqual({ code: "SUMMER", name: "Summer sale" });
    expect(res.id).toBe("SUMMER");
  });

  it("updateCoupon PUTs the body and resolves to void", async () => {
    let body: unknown = null;
    server.use(
      http.put(`${BASE}/coupons/SUMMER`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 200 });
      }),
    );
    await expect(svc().updateCoupon("SUMMER", { name: "Summer" })).resolves.toBeUndefined();
    expect(body).toEqual({ name: "Summer" });
  });

  it("patchCoupon PATCHes the partial body and resolves to void", async () => {
    let body: unknown = null;
    server.use(
      http.patch(`${BASE}/coupons/SUMMER`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 200 });
      }),
    );
    await svc().patchCoupon("SUMMER", { name: "Renamed" });
    expect(body).toEqual({ name: "Renamed" });
  });

  it("deleteCoupon DELETEs and resolves to void", async () => {
    server.use(http.delete(`${BASE}/coupons/SUMMER`, () => new HttpResponse(null, { status: 204 })));
    await expect(svc().deleteCoupon("SUMMER")).resolves.toBeUndefined();
  });

  it("validateCoupon POSTs to /validation and resolves to void on 200", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/coupons/SUMMER/validation`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 200 });
      }),
    );
    await expect(svc().validateCoupon("SUMMER", REDEMPTION)).resolves.toBeUndefined();
    expect(body).toEqual(REDEMPTION);
  });

  it("listRedemptions GETs the array", async () => {
    server.use(
      http.get(`${BASE}/coupons/SUMMER/redemptions`, () =>
        HttpResponse.json([{ id: "r1", redeemedAt: "2026-01-01T00:00:00Z" }]),
      ),
    );
    expect(await svc().listRedemptions("SUMMER")).toHaveLength(1);
  });

  it("redeemCoupon POSTs and returns the resource location", async () => {
    server.use(
      http.post(`${BASE}/coupons/SUMMER/redemptions`, () =>
        HttpResponse.json({ id: "r1" }, { status: 201 }),
      ),
    );
    const res = await svc().redeemCoupon("SUMMER", REDEMPTION);
    expect(res.id).toBe("r1");
  });

  it("getRedemption fetches one redemption", async () => {
    server.use(
      http.get(`${BASE}/coupons/SUMMER/redemptions/r1`, () => HttpResponse.json({ id: "r1" })),
    );
    expect((await svc().getRedemption("SUMMER", "r1")).id).toBe("r1");
  });

  it("deleteRedemption DELETEs and resolves to void", async () => {
    server.use(
      http.delete(`${BASE}/coupons/SUMMER/redemptions/r1`, () => new HttpResponse(null, { status: 204 })),
    );
    await expect(svc().deleteRedemption("SUMMER", "r1")).resolves.toBeUndefined();
  });

  it("getReferralCoupon fetches by customerNumber", async () => {
    server.use(
      http.get(`${BASE}/referral-coupons/C0123`, () => HttpResponse.json({ code: "REF-C0123" })),
    );
    expect((await svc().getReferralCoupon("C0123")).code).toBe("REF-C0123");
  });

  it("createReferralCoupon POSTs (no body) for a customerNumber", async () => {
    let method = "";
    server.use(
      http.post(`${BASE}/referral-coupons/C0123`, ({ request }) => {
        method = request.method;
        return HttpResponse.json({ code: "REF-C0123" });
      }),
    );
    const res = await svc().createReferralCoupon("C0123");
    expect(method).toBe("POST");
    expect(res.code).toBe("REF-C0123");
  });

  it("encodeURIComponent-escapes the coupon code in the path", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/coupon/acme/coupons/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({ code: "a/b" });
      }),
    );
    await svc().getCoupon("a/b");
    expect(pathname).toBe("/coupon/acme/coupons/a%2Fb");
  });
});
