import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { WebhookService } from "../../src/services/webhook";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { EmporixNotFoundError, EmporixError } from "../../src/core/errors";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "webhook" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new WebhookService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/webhook/acme";

describe("WebhookService", () => {
  it("listEventSubscriptions GETs the catalog with a service token", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(`${BASE}/event-subscriptions`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json([
          { event: { type: "product.created" }, subscription: "SUBSCRIBED", excludedFields: [] },
        ]);
      }),
    );
    const rows = await svc().listEventSubscriptions();
    expect(seenAuth).toBe("Bearer svc-tok");
    expect(rows[0]?.subscription).toBe("SUBSCRIBED");
  });

  it("updateEventSubscriptions PATCHes items and returns the 207 per-item result array", async () => {
    let body: unknown = null;
    server.use(
      http.patch(`${BASE}/event-subscriptions`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          [
            { eventType: "product.created", code: 200, status: "OK", message: "subscribed" },
            { eventType: "order.bad", code: 409, status: "CONFLICT", message: "stale version" },
          ],
          { status: 207 },
        );
      }),
    );
    const results = await svc().updateEventSubscriptions([
      { eventType: "product.created", action: "SUBSCRIBE" },
      { eventType: "order.bad", action: "SUBSCRIBE", metadata: { version: 1 } },
    ]);
    expect(body).toEqual([
      { eventType: "product.created", action: "SUBSCRIBE" },
      { eventType: "order.bad", action: "SUBSCRIBE", metadata: { version: 1 } },
    ]);
    // 207 is success — no throw — and partial failures are observable.
    expect(results).toHaveLength(2);
    expect(results.filter((r) => (r.code ?? 0) >= 400)).toHaveLength(1);
  });

  it("listConfigs GETs /config", async () => {
    server.use(
      http.get(`${BASE}/config`, () =>
        HttpResponse.json([{ code: "cfg_1", active: true, provider: "SVIX_SHARED", configuration: {} }]),
      ),
    );
    const rows = await svc().listConfigs();
    expect(rows[0]?.code).toBe("cfg_1");
  });

  it("getConfig GETs one config", async () => {
    server.use(
      http.get(`${BASE}/config/cfg_1`, () =>
        HttpResponse.json({ code: "cfg_1", active: true, provider: "HTTP", configuration: { destinationUrl: "https://x", secretKeyExists: true } }),
      ),
    );
    const c = await svc().getConfig("cfg_1");
    expect(c.provider).toBe("HTTP");
  });

  it("getConfig throws EmporixNotFoundError on 404", async () => {
    server.use(
      http.get(`${BASE}/config/missing`, () =>
        HttpResponse.json({ status: 404, message: "not found" }, { status: 404 }),
      ),
    );
    await expect(svc().getConfig("missing")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("createConfig POSTs the draft and returns { code }", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/config`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ code: "cfg_new" }, { status: 201 });
      }),
    );
    const created = await svc().createConfig({
      code: "cfg_new",
      active: true,
      provider: "HTTP",
      configuration: { destinationUrl: "https://x", secretKey: "shh" },
    } as never);
    expect((body as { provider: string }).provider).toBe("HTTP");
    expect(created.code).toBe("cfg_new");
  });

  it("replaceConfig PUTs and resolves to void on 204", async () => {
    server.use(http.put(`${BASE}/config/cfg_1`, () => new HttpResponse(null, { status: 204 })));
    await expect(
      svc().replaceConfig("cfg_1", { code: "cfg_1", active: false, provider: "SVIX_SHARED", configuration: {} } as never),
    ).resolves.toBeUndefined();
  });

  it("patchConfig PATCHes an op array and resolves to void on 204", async () => {
    let body: unknown = null;
    server.use(
      http.patch(`${BASE}/config/cfg_1`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(
      svc().patchConfig("cfg_1", [{ op: "UPSERT", path: "/active", value: false }]),
    ).resolves.toBeUndefined();
    expect(body).toEqual([{ op: "UPSERT", path: "/active", value: false }]);
  });

  it("deleteConfig DELETEs with no query by default", async () => {
    let search = "x";
    server.use(
      http.delete(`${BASE}/config/cfg_1`, ({ request }) => {
        search = new URL(request.url).search;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(svc().deleteConfig("cfg_1")).resolves.toBeUndefined();
    expect(search).toBe("");
  });

  it("deleteConfig sends ?force=true when force is set", async () => {
    let force: string | null = "x";
    server.use(
      http.delete(`${BASE}/config/cfg_1`, ({ request }) => {
        force = new URL(request.url).searchParams.get("force");
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await svc().deleteConfig("cfg_1", { force: true });
    expect(force).toBe("true");
  });

  it("deleteConfig of the active config without force surfaces the 409", async () => {
    server.use(
      http.delete(`${BASE}/config/cfg_active`, () =>
        HttpResponse.json({ status: 409, message: "active config" }, { status: 409 }),
      ),
    );
    await expect(svc().deleteConfig("cfg_active")).rejects.toBeInstanceOf(EmporixError);
  });

  it("getStatistics serializes the YYYY-MM range", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.get(`${BASE}/statistics`, ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json({ total: 0 });
      }),
    );
    await svc().getStatistics({ fromYearMonth: "2026-01", toYearMonth: "2026-03" });
    expect((q as URLSearchParams | null)?.get("fromYearMonth")).toBe("2026-01");
    expect((q as URLSearchParams | null)?.get("toYearMonth")).toBe("2026-03");
  });

  it("getStatistics sends no query when called empty", async () => {
    let search = "x";
    server.use(
      http.get(`${BASE}/statistics`, ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json({ total: 0 });
      }),
    );
    await svc().getStatistics();
    expect(search).toBe("");
  });

  it("getDashboardAccess GETs /dashboard-access", async () => {
    server.use(
      http.get(`${BASE}/dashboard-access`, () => HttpResponse.json({ url: "https://app.svix.com/..." })),
    );
    const access = await svc().getDashboardAccess();
    expect(access).toBeTruthy();
  });

  it("encodeURIComponent-escapes the config code in the path", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/webhook/acme/config/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({ code: "a/b", active: false, provider: "SVIX_SHARED", configuration: {} });
      }),
    );
    await svc().getConfig("a/b");
    expect(pathname).toBe("/webhook/acme/config/a%2Fb");
  });
});
