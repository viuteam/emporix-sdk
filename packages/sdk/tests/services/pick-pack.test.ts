import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { PickPackService } from "../../src/services/pick-pack";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "pick-pack" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new PickPackService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/pick-pack/acme";

describe("PickPackService", () => {
  it("listOrders GETs the packlist with a service token", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(`${BASE}/orders`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json([{ orderId: "o1" }]);
      }),
    );
    await svc().listOrders();
    expect(seenAuth).toBe("Bearer svc-tok");
  });

  it("getOrder / updateOrder / finishOrder", async () => {
    let patchBody: unknown = null;
    server.use(
      http.get(`${BASE}/orders/o1`, () => HttpResponse.json({ orderId: "o1" })),
      http.patch(`${BASE}/orders/o1`, async ({ request }) => {
        patchBody = await request.json();
        return HttpResponse.json({ message: "ok", code: 200 });
      }),
      http.post(`${BASE}/orders/o1/finish`, () => HttpResponse.json({ message: "finished" })),
    );
    expect((await svc().getOrder("o1")) as { orderId?: string }).toEqual({ orderId: "o1" });
    expect((await svc().updateOrder("o1", { status: "PACKED" } as never)).message).toBe("ok");
    expect(patchBody).toEqual({ status: "PACKED" });
    await expect(svc().finishOrder("o1")).resolves.toBeDefined();
  });

  it("getOrder throws EmporixNotFoundError on 404", async () => {
    server.use(http.get(`${BASE}/orders/NOPE`, () => HttpResponse.json({ status: 404, message: "x" }, { status: 404 })));
    await expect(svc().getOrder("NOPE")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("listOrderCycles GETs /orderCycles (string ids)", async () => {
    server.use(http.get(`${BASE}/orderCycles`, () => HttpResponse.json(["cy1", "cy2"])));
    expect(await svc().listOrderCycles()).toEqual(["cy1", "cy2"]);
  });

  it("assignees: add + remove", async () => {
    let addBody: unknown = null;
    server.use(
      http.post(`${BASE}/orders/o1/assignees`, async ({ request }) => {
        addBody = await request.json();
        return HttpResponse.json({ message: "added" });
      }),
      http.delete(`${BASE}/orders/o1/assignees/a1`, () => new HttpResponse(null, { status: 204 })),
    );
    await expect(svc().addAssignee("o1", { id: "a1" } as never)).resolves.toBeDefined();
    expect(addBody).toEqual({ id: "a1" });
    await expect(svc().removeAssignee("o1", "a1")).resolves.toBeUndefined();
  });

  it("updatePackaging PUTs to /packaging", async () => {
    let body: unknown = null;
    server.use(
      http.put(`${BASE}/orders/o1/packaging`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ message: "ok" });
      }),
    );
    await expect(svc().updatePackaging("o1", { products: [] } as never)).resolves.toBeDefined();
    expect(body).toEqual({ products: [] });
  });

  it("events: create + list", async () => {
    let createBody: unknown = null;
    server.use(
      http.post(`${BASE}/events`, async ({ request }) => {
        createBody = await request.json();
        return HttpResponse.json({ message: "ok" });
      }),
      http.get(`${BASE}/events`, () => HttpResponse.json([{ id: "e1" }])),
    );
    await expect(svc().createEvent({ type: "PACKED" } as never)).resolves.toBeDefined();
    expect(createBody).toEqual({ type: "PACKED" });
    await expect(svc().listEvents()).resolves.toBeDefined();
  });

  it("recalculation: trigger returns jobId, get returns the job", async () => {
    server.use(
      http.post(`${BASE}/jobs/recalculations`, () => HttpResponse.json({ jobId: "j1" })),
      http.get(`${BASE}/jobs/recalculations/j1`, () => HttpResponse.json({ id: "j1" })),
    );
    expect((await svc().triggerRecalculation({} as never)).jobId).toBe("j1");
    await expect(svc().getRecalculationJob("j1")).resolves.toBeDefined();
  });

  it("encodeURIComponent-escapes the order id", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/pick-pack/acme/orders/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({});
      }),
    );
    await svc().getOrder("a/b");
    expect(pathname).toBe("/pick-pack/acme/orders/a%2Fb");
  });
});
