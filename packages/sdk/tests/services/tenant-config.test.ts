import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { TenantConfigService } from "../../src/services/tenant-config";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "configuration" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new TenantConfigService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/configuration/acme/configurations";

describe("TenantConfigService", () => {
  it("list GETs all configurations with a service token and no query", async () => {
    let seenAuth: string | null = null;
    let seenSearch = "x";
    server.use(
      http.get(BASE, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        seenSearch = new URL(request.url).search;
        return HttpResponse.json([
          { key: "checkout", value: { mode: "b2c" }, version: 1 },
          { key: "flags", value: true, version: 0 },
        ]);
      }),
    );
    const rows = await svc().list();
    expect(seenAuth).toBe("Bearer svc-tok");
    expect(seenSearch).toBe("");
    expect(rows.map((r) => r.key)).toEqual(["checkout", "flags"]);
  });

  it("list serializes keys to a CSV query param", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.get(BASE, ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json([]);
      }),
    );
    await svc().list({ keys: ["a", "b"] });
    expect((q as URLSearchParams | null)?.get("keys")).toBe("a,b");
  });

  it("get fetches one configuration by key with a typed value", async () => {
    server.use(
      http.get(`${BASE}/checkout`, () =>
        HttpResponse.json({ key: "checkout", value: { mode: "b2c" }, version: 2 }),
      ),
    );
    const c = await svc().get<{ mode: string }>("checkout");
    expect(c.value.mode).toBe("b2c");
  });

  it("get throws EmporixNotFoundError on 404", async () => {
    server.use(
      http.get(`${BASE}/missing`, () =>
        HttpResponse.json({ status: 404, message: "not found" }, { status: 404 }),
      ),
    );
    await expect(svc().get("missing")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("create POSTs the draft array and returns the created array", async () => {
    let body: unknown = null;
    server.use(
      http.post(BASE, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json([{ key: "flags", value: true, version: 0 }], { status: 201 });
      }),
    );
    const created = await svc().create([{ key: "flags", value: true, secured: false }]);
    expect(body).toEqual([{ key: "flags", value: true, secured: false }]);
    expect(created[0]?.key).toBe("flags");
  });

  it("update PUTs the draft and returns the updated configuration", async () => {
    let body: unknown = null;
    server.use(
      http.put(`${BASE}/flags`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ key: "flags", value: false, version: 1 });
      }),
    );
    const updated = await svc().update("flags", { key: "flags", value: false });
    expect(body).toEqual({ key: "flags", value: false });
    expect(updated.value).toBe(false);
  });

  it("delete DELETEs and resolves to void", async () => {
    server.use(http.delete(`${BASE}/flags`, () => new HttpResponse(null, { status: 204 })));
    await expect(svc().delete("flags")).resolves.toBeUndefined();
  });

  it("encodeURIComponent-escapes the key in the path", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/configuration/acme/configurations/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({ key: "a/b", value: 1, version: 0 });
      }),
    );
    await svc().get("a/b");
    expect(pathname).toBe("/configuration/acme/configurations/a%2Fb");
  });
});
