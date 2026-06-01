import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { LabelService } from "../../src/services/label";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "label" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new LabelService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/label/labels";

describe("LabelService", () => {
  it("listLabels GETs /label/labels with a service token", async () => {
    let seenAuth: string | null = null;
    let pathname = "";
    server.use(
      http.get(BASE, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        pathname = new URL(request.url).pathname;
        return HttpResponse.json([{ id: "l1" }]);
      }),
    );
    await svc().listLabels();
    expect(seenAuth).toBe("Bearer svc-tok");
    expect(pathname).toBe("/label/labels");
  });

  it("getLabel fetches one by id", async () => {
    server.use(http.get(`${BASE}/l1`, () => HttpResponse.json({ id: "l1" })));
    expect((await svc().getLabel("l1")) as { id?: string }).toEqual({ id: "l1" });
  });

  it("getLabel throws EmporixNotFoundError on 404", async () => {
    server.use(http.get(`${BASE}/NOPE`, () => HttpResponse.json({ status: 404, message: "x" }, { status: 404 })));
    await expect(svc().getLabel("NOPE")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("createLabel POSTs the body", async () => {
    let body: unknown = null;
    server.use(
      http.post(BASE, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "l1" }, { status: 201 });
      }),
    );
    await svc().createLabel({ name: "Sale" } as never);
    expect(body).toEqual({ name: "Sale" });
  });

  it("updateLabel PUTs to the id", async () => {
    let body: unknown = null;
    server.use(
      http.put(`${BASE}/l1`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "l1" });
      }),
    );
    await svc().updateLabel("l1", { name: "Sale2" } as never);
    expect(body).toEqual({ name: "Sale2" });
  });

  it("patchLabel PATCHes the id", async () => {
    let body: unknown = null;
    server.use(
      http.patch(`${BASE}/l1`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "l1" });
      }),
    );
    await svc().patchLabel("l1", { name: "Renamed" } as never);
    expect(body).toEqual({ name: "Renamed" });
  });

  it("deleteLabel DELETEs and resolves to void", async () => {
    server.use(http.delete(`${BASE}/l1`, () => new HttpResponse(null, { status: 204 })));
    await expect(svc().deleteLabel("l1")).resolves.toBeUndefined();
  });

  it("encodeURIComponent-escapes the label id", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/label/labels/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({});
      }),
    );
    await svc().getLabel("a/b");
    expect(pathname).toBe("/label/labels/a%2Fb");
  });
});
