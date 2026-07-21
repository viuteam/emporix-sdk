import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { SchemaService } from "../../src/services/schema";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "schema" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new SchemaService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/schema/acme";

describe("SchemaService.bulkPatchInstances", () => {
  it("PATCHes the items array and returns the 207 per-item results", async () => {
    let body: unknown = null;
    server.use(
      http.patch(`${BASE}/custom-entities/car/instances/bulk`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          [{ index: 0, id: "Ford", code: 204, status: "No Content" }],
          { status: 207 },
        );
      }),
    );
    const res = await svc().bulkPatchInstances("car", [
      { id: "Ford", data: [{ op: "REPLACE", path: "/name/en", value: "Ford" }] },
    ]);
    expect(body).toEqual([{ id: "Ford", data: [{ op: "REPLACE", path: "/name/en", value: "Ford" }] }]);
    expect(res[0]?.code).toBe(204);
  });
});
