import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { SequentialIdService } from "../../src/services/sequential-id";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "sequential-id" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new SequentialIdService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const SCHEMAS = "https://api.emporix.io/sequential-id/acme/schemas";

describe("SequentialIdService", () => {
  it("listSchemas GETs all schemas with a service token", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(SCHEMAS, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json([{ id: "sch_1", name: "order", active: true }]);
      }),
    );
    const rows = await svc().listSchemas();
    expect(seenAuth).toBe("Bearer svc-tok");
    expect(rows[0]?.id).toBe("sch_1");
  });

  it("getSchema fetches one schema by id", async () => {
    server.use(
      http.get(`${SCHEMAS}/sch_1`, () => HttpResponse.json({ id: "sch_1", name: "order", active: true })),
    );
    const s = await svc().getSchema("sch_1");
    expect(s.name).toBe("order");
  });

  it("getSchema throws EmporixNotFoundError on 404", async () => {
    server.use(
      http.get(`${SCHEMAS}/missing`, () =>
        HttpResponse.json({ status: 404, message: "not found" }, { status: 404 }),
      ),
    );
    await expect(svc().getSchema("missing")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("createSchema POSTs the body and returns the created schema", async () => {
    let body: unknown = null;
    server.use(
      http.post(SCHEMAS, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "sch_2", name: "invoice", active: false }, { status: 201 });
      }),
    );
    const created = await svc().createSchema({
      name: "invoice",
      startValue: 1,
      maxValue: 999999,
      numberOfDigits: 6,
    });
    expect(body).toEqual({ name: "invoice", startValue: 1, maxValue: 999999, numberOfDigits: 6 });
    expect(created.id).toBe("sch_2");
  });

  it("deleteSchema DELETEs and resolves to void", async () => {
    server.use(http.delete(`${SCHEMAS}/sch_1`, () => new HttpResponse(null, { status: 204 })));
    await expect(svc().deleteSchema("sch_1")).resolves.toBeUndefined();
  });

  it("setActiveSchema POSTs /setActive and resolves to void", async () => {
    let hit = false;
    server.use(
      http.post(`${SCHEMAS}/sch_1/setActive`, () => {
        hit = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(svc().setActiveSchema("sch_1")).resolves.toBeUndefined();
    expect(hit).toBe(true);
  });

  it("listSchemasByType GETs the active schema for a type", async () => {
    server.use(
      http.get(`${SCHEMAS}/types/order`, () => HttpResponse.json({ id: "sch_1", name: "order", active: true })),
    );
    const s = await svc().listSchemasByType("order");
    expect(s.id).toBe("sch_1");
  });

  it("nextId POSTs the body and omits siteCode when not provided", async () => {
    let body: unknown = null;
    let search = "x";
    server.use(
      http.post(`${SCHEMAS}/types/order/nextId`, async ({ request }) => {
        body = await request.json();
        search = new URL(request.url).search;
        return HttpResponse.json({ id: "ORD-000123" });
      }),
    );
    const res = await svc().nextId("order", { sequenceKey: "store-1" });
    expect(body).toEqual({ sequenceKey: "store-1" });
    expect(search).toBe("");
    expect(res.id).toBe("ORD-000123");
  });

  it("nextId serializes ?siteCode= when provided", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.post(`${SCHEMAS}/types/order/nextId`, ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json({ id: "ORD-000124" });
      }),
    );
    await svc().nextId("order", {}, { siteCode: "main" });
    expect((q as URLSearchParams | null)?.get("siteCode")).toBe("main");
  });

  it("nextIdsBatch POSTs to a tenant-less batch path and returns the id map", async () => {
    let pathname = "";
    let body: unknown = null;
    server.use(
      http.post("https://api.emporix.io/sequential-id/sequenceSchemaBatch/nextIds", async ({ request }) => {
        pathname = new URL(request.url).pathname;
        body = await request.json();
        return HttpResponse.json({ order: { ids: ["ORD-1", "ORD-2"] } });
      }),
    );
    const res = await svc().nextIdsBatch({ order: { numberOfIds: 2 } });
    expect(pathname).toBe("/sequential-id/sequenceSchemaBatch/nextIds");
    expect(body).toEqual({ order: { numberOfIds: 2 } });
    expect(res.order?.ids).toEqual(["ORD-1", "ORD-2"]);
  });

  it("encodeURIComponent-escapes the schema type in the path", async () => {
    let pathname = "";
    server.use(
      http.post("https://api.emporix.io/sequential-id/acme/schemas/types/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({ id: "X" });
      }),
    );
    await svc().nextId("a/b");
    expect(pathname).toBe("/sequential-id/acme/schemas/types/a%2Fb/nextId");
  });
});
