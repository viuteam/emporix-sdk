import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { RewardPointsService } from "../../src/services/reward-points";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider, auth } from "../../src/core/auth";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "reward-points" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new RewardPointsService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const RP = "https://api.emporix.io/reward-points";

describe("RewardPointsService", () => {
  it("listAllSummaries GETs the batch with a service token", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(`${RP}/summaryBatch`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json([{ openPoints: 10 }]);
      }),
    );
    const out = await svc().listAllSummaries();
    expect(seenAuth).toBe("Bearer svc-tok");
    expect(out).toHaveLength(1);
  });

  it("getCustomerPoints GETs a customer's balance (no tenant in path)", async () => {
    let pathname = "";
    server.use(
      http.get(`${RP}/customer/C1`, ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json(150);
      }),
    );
    const balance = await svc().getCustomerPoints("C1");
    expect(pathname).toBe("/reward-points/customer/C1");
    expect(balance).toBe(150);
  });

  it("createCustomerPoints POSTs the entry and resolves to void", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${RP}/customer/C1`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 200 });
      }),
    );
    await expect(svc().createCustomerPoints("C1", { points: 100 } as never)).resolves.toBeUndefined();
    expect(body).toEqual({ points: 100 });
  });

  it("deleteCustomerPoints DELETEs and resolves to void", async () => {
    server.use(http.delete(`${RP}/customer/C1`, () => new HttpResponse(null, { status: 204 })));
    await expect(svc().deleteCustomerPoints("C1")).resolves.toBeUndefined();
  });

  it("getCustomerSummary GETs the per-customer summary", async () => {
    server.use(http.get(`${RP}/customer/C1/summary`, () => HttpResponse.json({ openPoints: 50 })));
    await expect(svc().getCustomerSummary("C1")).resolves.toBeDefined();
  });

  it("addPoints POSTs to /addPoints and resolves to void", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${RP}/customer/C1/addPoints`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 201 });
      }),
    );
    await expect(svc().addPoints("C1", { points: 10 } as never)).resolves.toBeUndefined();
    expect(body).toEqual({ points: 10 });
  });

  it("redeemPoints POSTs to /redeemPoints and resolves to void", async () => {
    server.use(http.post(`${RP}/customer/C1/redeemPoints`, () => new HttpResponse(null, { status: 201 })));
    await expect(svc().redeemPoints("C1", { points: 10 } as never)).resolves.toBeUndefined();
  });

  it("getMyPoints uses the CUSTOMER token on /public/customer", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(`${RP}/public/customer`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json(42);
      }),
    );
    const balance = await svc().getMyPoints(auth.customer("cust-tok"));
    expect(seenAuth).toBe("Bearer cust-tok");
    expect(balance).toBe(42);
  });

  it("getMySummary GETs /public/customer/summary with the customer token", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(`${RP}/public/customer/summary`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json({ openPoints: 10 });
      }),
    );
    await svc().getMySummary(auth.customer("cust-tok"));
    expect(seenAuth).toBe("Bearer cust-tok");
  });

  it("getMyPoints returns 0 when the customer has no reward-points entry (404)", async () => {
    // Emporix returns 404 "No reward points found for customer …" for a
    // signed-in customer who has never earned points — that means zero points,
    // not an error the storefront should surface.
    server.use(
      http.get(`${RP}/public/customer`, () =>
        HttpResponse.json(
          { type: "resource_not_found", status: 404, message: "No reward points found for customer 1" },
          { status: 404 },
        ),
      ),
    );
    await expect(svc().getMyPoints(auth.customer("cust-tok"))).resolves.toBe(0);
  });

  it("getMySummary returns an empty summary when the customer has no entry (404)", async () => {
    server.use(
      http.get(`${RP}/public/customer/summary`, () =>
        HttpResponse.json(
          { type: "resource_not_found", status: 404, message: "No reward points found for customer 1" },
          { status: 404 },
        ),
      ),
    );
    const summary = await svc().getMySummary(auth.customer("cust-tok"));
    expect(summary.activePoints).toBe(0);
    expect(summary.summary?.addedPointsList).toEqual([]);
  });

  it("redeemMyPoints POSTs the redeemOptionId and returns the coupon code", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${RP}/public/customer/redeem`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ code: "WELCOME10" });
      }),
    );
    const res = await svc().redeemMyPoints({ redeemOptionId: "opt-1" }, auth.customer("cust-tok"));
    expect(body).toEqual({ redeemOptionId: "opt-1" });
    expect(res.code).toBe("WELCOME10");
  });

  it("listRedeemOptions GETs the tenant-scoped options", async () => {
    let pathname = "";
    server.use(
      http.get(`${RP}/acme/redeemOptions`, ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json([{ id: "opt-1" }]);
      }),
    );
    await svc().listRedeemOptions();
    expect(pathname).toBe("/reward-points/acme/redeemOptions");
  });

  it("createRedeemOption POSTs and returns the updated options list", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${RP}/acme/redeemOptions`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json([{ id: "opt-1", points: 100 }]);
      }),
    );
    const res = await svc().createRedeemOption({ points: 100, type: "coupon" } as never);
    expect(body).toEqual({ points: 100, type: "coupon" });
    expect(res[0]?.id).toBe("opt-1");
  });

  it("updateRedeemOption PUTs to the option id and resolves to void", async () => {
    let body: unknown = null;
    server.use(
      http.put(`${RP}/acme/redeemOptions/opt-1`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(svc().updateRedeemOption("opt-1", { points: 200 } as never)).resolves.toBeUndefined();
    expect(body).toEqual({ points: 200 });
  });

  it("deleteRedeemOption DELETEs and resolves to void", async () => {
    server.use(http.delete(`${RP}/acme/redeemOptions/opt-1`, () => new HttpResponse(null, { status: 204 })));
    await expect(svc().deleteRedeemOption("opt-1")).resolves.toBeUndefined();
  });

  it("getCustomerPoints throws EmporixNotFoundError on 404", async () => {
    server.use(
      http.get(`${RP}/customer/NOPE`, () => HttpResponse.json({ status: 404, message: "x" }, { status: 404 })),
    );
    await expect(svc().getCustomerPoints("NOPE")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("encodeURIComponent-escapes the customer id", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/reward-points/customer/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json(0);
      }),
    );
    await svc().getCustomerPoints("a/b");
    expect(pathname).toBe("/reward-points/customer/a%2Fb");
  });
});
