import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { ClientConfigService } from "../../src/services/client-config";
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

function svc() {
  const cfg = {
    tenant: "acme",
    host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "configuration" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new ClientConfigService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/configuration/acme/clients/saas-ag.x/configurations";

describe("ClientConfigService", () => {
  it("list GETs configurations for the client", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(BASE, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json([
          { _id: "saas-ag.x_flags", client: "saas-ag.x", key: "flags", value: true, version: 0 },
        ]);
      }),
    );
    const rows = await svc().list("saas-ag.x");
    expect(seenAuth).toBe("Bearer svc-tok");
    expect(rows[0]?._id).toBe("saas-ag.x_flags");
  });

  it("list serializes keys to a CSV query param", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.get(BASE, ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json([]);
      }),
    );
    await svc().list("saas-ag.x", { keys: ["a", "b"] });
    expect((q as URLSearchParams | null)?.get("keys")).toBe("a,b");
  });

  it("get fetches one client configuration by key", async () => {
    server.use(
      http.get(`${BASE}/flags`, () =>
        HttpResponse.json({ _id: "saas-ag.x_flags", client: "saas-ag.x", key: "flags", value: true, version: 1 }),
      ),
    );
    const c = await svc().get<boolean>("saas-ag.x", "flags");
    expect(c.value).toBe(true);
    expect(c.client).toBe("saas-ag.x");
  });

  it("create injects the client into each body item and returns the created array", async () => {
    let body: unknown = null;
    server.use(
      http.post(BASE, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          [{ _id: "saas-ag.x_flags", client: "saas-ag.x", key: "flags", value: true, version: 0 }],
          { status: 201 },
        );
      }),
    );
    const created = await svc().create("saas-ag.x", [{ key: "flags", value: true }]);
    expect(body).toEqual([{ key: "flags", value: true, client: "saas-ag.x" }]);
    expect(created[0]?._id).toBe("saas-ag.x_flags");
  });

  it("update injects the client and PUTs the draft", async () => {
    let body: unknown = null;
    server.use(
      http.put(`${BASE}/flags`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ _id: "saas-ag.x_flags", client: "saas-ag.x", key: "flags", value: false, version: 1 });
      }),
    );
    const updated = await svc().update("saas-ag.x", "flags", { key: "flags", value: false });
    expect(body).toEqual({ key: "flags", value: false, client: "saas-ag.x" });
    expect(updated.value).toBe(false);
  });

  it("delete DELETEs and resolves to void", async () => {
    server.use(http.delete(`${BASE}/flags`, () => new HttpResponse(null, { status: 204 })));
    await expect(svc().delete("saas-ag.x", "flags")).resolves.toBeUndefined();
  });
});
