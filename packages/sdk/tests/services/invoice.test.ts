import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { InvoiceService } from "../../src/services/invoice";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";

const server = setupServer(
  http.post("https://api.emporix.io/oauth/token", () =>
    HttpResponse.json({ access_token: "svc-tok", token_type: "Bearer", expires_in: 3599 }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function ctx() {
  const cfg = {
    tenant: "acme",
    host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "invoice" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return { tenant: "acme", http: httpClient, tokenProvider, logger };
}

const BASE = "https://api.emporix.io";

describe("InvoiceService", () => {
  it("createJob POSTs the draft and returns { jobId } (201)", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/invoice/acme/jobs/invoices`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ jobId: "job-1" }, { status: 201 });
      }),
    );
    const svc = new InvoiceService(ctx());
    const res = await svc.createJob({ jobType: "MANUAL", orderIds: ["o1", "o2"] });
    expect(res).toEqual({ jobId: "job-1" });
    expect(body).toEqual({ jobType: "MANUAL", orderIds: ["o1", "o2"] });
  });

  it("getJob GETs the job by id", async () => {
    server.use(
      http.get(`${BASE}/invoice/acme/jobs/invoices/job-1`, () =>
        HttpResponse.json({
          jobStatus: "DONE",
          jobType: "MANUAL",
          orders: [{ orderId: "o1", orderStatus: "SUCCESS" }],
        }),
      ),
    );
    const svc = new InvoiceService(ctx());
    const res = await svc.getJob("job-1");
    expect(res.jobStatus).toBe("DONE");
    expect(res.orders?.[0]?.orderId).toBe("o1");
  });
});
