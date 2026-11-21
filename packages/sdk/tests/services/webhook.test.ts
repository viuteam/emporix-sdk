import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { WebhookService } from "../../src/services/webhook";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { EmporixNotFoundError, EmporixError, EmporixConflictError } from "../../src/core/errors";
import type { AuthContext } from "../../src/core/auth";
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

describe("WebhookService config expand", () => {
  const RAW: AuthContext = { kind: "raw", token: "raw-tok" };

  it("listConfigs forwards expand, and sends no query without it", async () => {
    const seen: string[] = [];
    server.use(
      http.get(`${BASE}/config`, ({ request }) => {
        seen.push(new URL(request.url).search);
        return HttpResponse.json([]);
      }),
    );
    await svc().listConfigs({ expand: "deliveryStatus" });
    await svc().listConfigs();
    expect(seen).toEqual(["?expand=deliveryStatus", ""]);
  });

  it("listConfigs(auth) and getConfig(code, auth) still read the auth context as auth", async () => {
    const seen: { auth: string | null; search: string }[] = [];
    const record = ({ request }: { request: Request }) => {
      seen.push({ auth: request.headers.get("authorization"), search: new URL(request.url).search });
      return HttpResponse.json(request.url.endsWith("/config") ? [] : { code: "c1" });
    };
    server.use(http.get(`${BASE}/config`, record), http.get(`${BASE}/config/c1`, record));
    await svc().listConfigs(RAW);
    await svc().getConfig("c1", RAW);
    expect(seen).toEqual([
      { auth: "Bearer raw-tok", search: "" },
      { auth: "Bearer raw-tok", search: "" },
    ]);
  });

  it("getConfig forwards expand with an explicit auth", async () => {
    let seen = { auth: null as string | null, expand: null as string | null };
    server.use(
      http.get(`${BASE}/config/c1`, ({ request }) => {
        seen = {
          auth: request.headers.get("authorization"),
          expand: new URL(request.url).searchParams.get("expand"),
        };
        return HttpResponse.json({ code: "c1" });
      }),
    );
    await svc().getConfig("c1", { expand: "deliveryStatus" }, RAW);
    expect(seen).toEqual({ auth: "Bearer raw-tok", expand: "deliveryStatus" });
  });
});

describe("WebhookService failed messages and jobs", () => {
  const ID = "12052814953937469:http:3f1a2b4c";
  const ENCODED = "12052814953937469%3Ahttp%3A3f1a2b4c";

  it("listFailedMessages forwards filters and paging, omits what is unset, and reads the cursors", async () => {
    const seen: URLSearchParams[] = [];
    let totalHeader: string | null = "unset";
    server.use(
      http.get(`${BASE}/failed-messages`, ({ request }) => {
        seen.push(new URL(request.url).searchParams);
        totalHeader = request.headers.get("x-total-count");
        return HttpResponse.json([{ id: ID }], {
          headers: { "X-Next-Cursor": "c-next", "X-Prev-Cursor": "c-prev" },
        });
      }),
    );
    const page = await svc().listFailedMessages({
      configCode: "http",
      eventType: "product.created",
      sort: "failedAt:asc",
      pageSize: 10,
    });
    const q = seen[0] as URLSearchParams;
    expect(Object.fromEntries(q)).toEqual({
      configCode: "http",
      eventType: "product.created",
      sort: "failedAt:asc",
      pageNumber: "1",
      pageSize: "10",
    });
    expect(totalHeader).toBeNull();
    expect(page).toMatchObject({ items: [{ id: ID }], nextCursor: "c-next", prevCursor: "c-prev", hasNextPage: true });
  });

  it("listFailedMessages sends totalCount as a header, never as a query parameter", async () => {
    let seen = { header: null as string | null, query: null as string | null };
    server.use(
      http.get(`${BASE}/failed-messages`, ({ request }) => {
        seen = {
          header: request.headers.get("x-total-count"),
          query: new URL(request.url).searchParams.get("totalCount"),
        };
        return HttpResponse.json([], { headers: { "X-Total-Count": "0" } });
      }),
    );
    const page = await svc().listFailedMessages({ totalCount: true });
    expect(seen).toEqual({ header: "true", query: null });
    expect(page.totalCount).toBe(0);
  });

  it("listFailedMessages drops pageNumber in cursor mode", async () => {
    let q = new URLSearchParams();
    server.use(
      http.get(`${BASE}/failed-messages`, ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json([]);
      }),
    );
    await svc().listFailedMessages({ next: "c-next", pageNumber: 3 });
    expect(Object.fromEntries(q)).toEqual({ next: "c-next", pageSize: "60" });
  });

  it("getFailedMessage and deleteFailedMessage encode the id, colons included", async () => {
    const seen: string[] = [];
    server.use(
      http.get(`${BASE}/failed-messages/*`, ({ request }) => {
        seen.push(`GET ${new URL(request.url).pathname}`);
        return HttpResponse.json({ id: ID, payload: { code: "SKU-1" } });
      }),
      http.delete(`${BASE}/failed-messages/*`, ({ request }) => {
        seen.push(`DELETE ${new URL(request.url).pathname}`);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const msg = await svc().getFailedMessage(ID);
    await svc().deleteFailedMessage(ID);
    expect(msg.payload).toEqual({ code: "SKU-1" });
    expect(seen).toEqual([
      `GET /webhook/acme/failed-messages/${ENCODED}`,
      `DELETE /webhook/acme/failed-messages/${ENCODED}`,
    ]);
  });

  it("resendFailedMessage POSTs to /resend and surfaces a 409 as EmporixConflictError", async () => {
    let pathname = "";
    server.use(
      http.post(`${BASE}/failed-messages/*`, ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json(
          { code: 409, status: "Conflict", message: "Config 'http' was switched off" },
          { status: 409 },
        );
      }),
    );
    await expect(svc().resendFailedMessage(ID)).rejects.toBeInstanceOf(EmporixConflictError);
    expect(pathname).toBe(`/webhook/acme/failed-messages/${ENCODED}/resend`);
  });

  it("restartFailedMessages sends the selection, an empty one included, and returns the job id", async () => {
    const bodies: unknown[] = [];
    server.use(
      http.post(`${BASE}/failed-messages/restart`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ id: "job-1" }, { status: 202 });
      }),
    );
    const started = await svc().restartFailedMessages({ configCode: "http", entryId: "e1" });
    await svc().restartFailedMessages({});
    expect(started).toEqual({ id: "job-1" });
    expect(bodies).toEqual([{ configCode: "http", entryId: "e1" }, {}]);
  });

  it("deleteFailedMessages POSTs the selection to /delete", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/failed-messages/delete`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await svc().deleteFailedMessages({ ids: [ID] });
    expect(body).toEqual({ ids: [ID] });
  });

  it("listJobs forwards sort and paging; getJob reads one job", async () => {
    let q = new URLSearchParams();
    let jobPath = "";
    server.use(
      http.get(`${BASE}/jobs`, ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json([{ id: "job-1", status: "success" }]);
      }),
      http.get(`${BASE}/jobs/*`, ({ request }) => {
        jobPath = new URL(request.url).pathname;
        return HttpResponse.json({ id: "job 1", status: "in_progress" });
      }),
    );
    const page = await svc().listJobs({ sort: "metadata.createdAt:asc" });
    const job = await svc().getJob("job 1");
    expect(Object.fromEntries(q)).toEqual({ sort: "metadata.createdAt:asc", pageNumber: "1", pageSize: "60" });
    expect(page.items[0]?.status).toBe("success");
    expect(jobPath).toBe("/webhook/acme/jobs/job%201");
    expect(job.status).toBe("in_progress");
  });
});
