import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { QuoteService } from "../../src/services/quote";
import { HttpClient } from "../../src/core/http";
import { auth, DefaultTokenProvider } from "../../src/core/auth";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "quote" });
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

describe("QuoteService", () => {
  it("list wraps the array in PaginatedItems and forwards q/paging with a customer token", async () => {
    let url: URL | null = null;
    let authz: string | null = null;
    server.use(
      http.get(`${BASE}/quote/acme/quotes`, ({ request }) => {
        url = new URL(request.url);
        authz = request.headers.get("authorization");
        return HttpResponse.json([{ id: "q1" }]);
      }),
    );
    const svc = new QuoteService(ctx());
    const page = await svc.list({ q: "state:OPEN", pageSize: 10 }, auth.customer("cust-tok"));
    expect(page.items).toEqual([{ id: "q1" }]);
    expect(page.hasNextPage).toBe(false);
    expect(url!.searchParams.get("q")).toBe("state:OPEN");
    expect(url!.searchParams.get("pageSize")).toBe("10");
    expect(authz).toBe("Bearer cust-tok");
  });

  it("create returns { id } (201)", async () => {
    server.use(http.post(`${BASE}/quote/acme/quotes`, () => HttpResponse.json({ id: "q1" }, { status: 201 })));
    const svc = new QuoteService(ctx());
    const res = await svc.create({ customerId: "c1" } as never, auth.customer("t"));
    expect(res).toEqual({ id: "q1" });
  });

  it("update PATCHes the op array and resolves void on 204", async () => {
    let body: unknown = null;
    server.use(
      http.patch(`${BASE}/quote/acme/quotes/q1`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const svc = new QuoteService(ctx());
    await expect(
      svc.update("q1", [{ op: "status", value: "APPROVED" }] as never, auth.customer("t")),
    ).resolves.toBeUndefined();
    expect(Array.isArray(body)).toBe(true);
  });

  it("get / history / delete hit the right paths", async () => {
    server.use(
      http.get(`${BASE}/quote/acme/quotes/q1`, () => HttpResponse.json({ id: "q1" })),
      http.get(`${BASE}/quote/acme/quotes/q1/history`, () => HttpResponse.json([{ changedAt: "t" }])),
      http.delete(`${BASE}/quote/acme/quotes/q1`, () => new HttpResponse(null, { status: 204 })),
    );
    const svc = new QuoteService(ctx());
    expect((await svc.get("q1", auth.customer("t"))).id).toBe("q1");
    expect(await svc.history("q1", auth.customer("t"))).toHaveLength(1);
    await expect(svc.delete("q1", auth.service())).resolves.toBeUndefined();
  });

  it("generatePdf returns a Blob and throws on non-2xx", async () => {
    const svc = new QuoteService(ctx());
    server.use(
      http.post(`${BASE}/quote/acme/quotes/q1/pdf`, () =>
        new HttpResponse(new Blob(["%PDF-1.4"]), {
          status: 200,
          headers: { "Content-Type": "application/pdf" },
        }),
      ),
    );
    const blob = await svc.generatePdf("q1", auth.customer("t"));
    expect(blob).toBeInstanceOf(Blob);

    server.use(
      http.post(`${BASE}/quote/acme/quotes/q1/pdf`, () => HttpResponse.json({ message: "nope" }, { status: 403 })),
    );
    await expect(svc.generatePdf("q1", auth.customer("t"))).rejects.toBeTruthy();
  });
});
