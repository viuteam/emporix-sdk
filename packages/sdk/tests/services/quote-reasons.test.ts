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

describe("QuoteService.reasons", () => {
  it("lists reasons (PaginatedItems)", async () => {
    server.use(http.get(`${BASE}/quote/acme/quote-reasons`, () => HttpResponse.json([{ id: "r1", type: "DECLINE" }])));
    const svc = new QuoteService(ctx());
    const page = await svc.reasons.list({}, auth.customer("t"));
    expect(page.items).toEqual([{ id: "r1", type: "DECLINE" }]);
  });

  it("create POSTs the draft (201) with the supplied service token", async () => {
    let authz: string | null = null;
    server.use(
      http.post(`${BASE}/quote/acme/quote-reasons`, ({ request }) => {
        authz = request.headers.get("authorization");
        return HttpResponse.json({ id: "r1" }, { status: 201 });
      }),
    );
    const svc = new QuoteService(ctx());
    const res = await svc.reasons.create(
      { type: "DECLINE", code: "OUT_OF_STOCK", message: { en: "Out of stock" } },
      auth.service(),
    );
    expect(res).toEqual({ id: "r1" });
    expect(authz).toBe("Bearer svc-tok");
  });

  it("update PUTs (204) and delete resolves void", async () => {
    server.use(
      http.put(`${BASE}/quote/acme/quote-reasons/r1`, () => new HttpResponse(null, { status: 204 })),
      http.delete(`${BASE}/quote/acme/quote-reasons/r1`, () => new HttpResponse(null, { status: 204 })),
    );
    const svc = new QuoteService(ctx());
    await expect(
      svc.reasons.update(
        "r1",
        { type: "CHANGE", code: "X", message: { en: "x" }, metadata: { version: 2 } },
        auth.service(),
      ),
    ).resolves.toBeUndefined();
    await expect(svc.reasons.delete("r1", auth.service())).resolves.toBeUndefined();
  });
});
