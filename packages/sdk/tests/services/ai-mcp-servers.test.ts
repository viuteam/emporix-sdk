import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { AiService } from "../../src/services/ai";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "ai" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new AiService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/ai-service/acme";

describe("AiService.mcpServers", () => {
  it("lists mcp servers at the hyphenated path", async () => {
    let hit = false;
    server.use(
      http.get(`${BASE}/agentic/mcp-servers`, () => {
        hit = true;
        return HttpResponse.json([{ id: "m1" }]);
      }),
    );
    expect(await svc().mcpServers.list()).toEqual([{ id: "m1" }]);
    expect(hit).toBe(true);
  });
  it("patches an mcp server", async () => {
    let body: unknown = null;
    server.use(
      http.patch(`${BASE}/agentic/mcp-servers/m1`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await svc().mcpServers.patch("m1", [{ op: "REPLACE", path: "/name", value: "renamed" }]);
    expect(body).toEqual([{ op: "REPLACE", path: "/name", value: "renamed" }]);
  });
});
