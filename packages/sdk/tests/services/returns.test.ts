import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { ReturnsService } from "../../src/services/returns";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "returns" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new ReturnsService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/return/acme/returns";

describe("ReturnsService", () => {
  it("listReturns GETs with a service token", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(BASE, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json([{ id: "r1" }]);
      }),
    );
    await svc().listReturns();
    expect(seenAuth).toBe("Bearer svc-tok");
  });

  it("getReturn fetches one by id", async () => {
    server.use(http.get(`${BASE}/r1`, () => HttpResponse.json({ id: "r1" })));
    expect((await svc().getReturn("r1")) as { id?: string }).toEqual({ id: "r1" });
  });

  it("getReturn throws EmporixNotFoundError on 404", async () => {
    server.use(http.get(`${BASE}/NOPE`, () => HttpResponse.json({ status: 404, message: "x" }, { status: 404 })));
    await expect(svc().getReturn("NOPE")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("createReturn POSTs the body and returns { id }", async () => {
    let body: unknown = null;
    server.use(
      http.post(BASE, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "r1" }, { status: 201 });
      }),
    );
    const res = await svc().createReturn({ orderId: "o1" } as never);
    expect(body).toEqual({ orderId: "o1" });
    expect(res.id).toBe("r1");
  });

  it("updateReturn (PUT) and deleteReturn resolve to void", async () => {
    let putBody: unknown = null;
    server.use(
      http.put(`${BASE}/r1`, async ({ request }) => {
        putBody = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
      http.delete(`${BASE}/r1`, () => new HttpResponse(null, { status: 204 })),
    );
    await expect(svc().updateReturn("r1", { status: "APPROVED" } as never)).resolves.toBeUndefined();
    expect(putBody).toEqual({ status: "APPROVED" });
    await expect(svc().deleteReturn("r1")).resolves.toBeUndefined();
  });

  it("patchReturn PATCHes a JSON-Patch op array and resolves to void", async () => {
    let body: unknown = null;
    server.use(
      http.patch(`${BASE}/r1`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(
      svc().patchReturn("r1", [{ op: "replace", path: "/status", value: "APPROVED" }] as never),
    ).resolves.toBeUndefined();
    expect(body).toEqual([{ op: "replace", path: "/status", value: "APPROVED" }]);
  });

  it("listReturns forwards query params", async () => {
    let search = "";
    server.use(
      http.get(BASE, ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json([]);
      }),
    );
    await svc().listReturns({ pageSize: 10, q: "status:OPEN" });
    expect(search).toContain("pageSize=10");
  });

  it("encodeURIComponent-escapes the return id", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/return/acme/returns/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({});
      }),
    );
    await svc().getReturn("a/b");
    expect(pathname).toBe("/return/acme/returns/a%2Fb");
  });
});
