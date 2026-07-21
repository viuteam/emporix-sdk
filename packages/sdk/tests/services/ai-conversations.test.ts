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

describe("AiService conversations", () => {
  it("listConversations GETs the array", async () => {
    server.use(
      http.get(`${BASE}/agentic/conversations`, () =>
        HttpResponse.json([{ conversationId: "c1" }, { conversationId: "c2" }]),
      ),
    );
    const res = await svc().listConversations();
    expect(res.map((c) => c.conversationId)).toEqual(["c1", "c2"]);
  });

  it("searchConversations POSTs the query and returns the array", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/agentic/conversations/search`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json([{ conversationId: "c9" }]);
      }),
    );
    const res = await svc().searchConversations({ q: "agentId:a" });
    expect(body).toEqual({ q: "agentId:a" });
    expect(res[0]?.conversationId).toBe("c9");
  });
});
