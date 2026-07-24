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

describe("AiService.analytics", () => {
  it("get forwards agentId", async () => {
    let url: URL | null = null;
    server.use(
      http.get(`${BASE}/agentic/analytics`, ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json({ requests: { total: 5 } });
      }),
    );
    const res = await svc().analytics.get({ agentId: "support" });
    expect(res).toEqual({ requests: { total: 5 } });
    expect(url!.searchParams.get("agentId")).toBe("support");
  });
  it("executions forwards agentIds + granularity", async () => {
    let url: URL | null = null;
    server.use(
      http.get(`${BASE}/agentic/analytics/executions`, ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json({ periods: [] });
      }),
    );
    await svc().analytics.executions({ agentIds: "a,b", granularity: "WEEK" });
    expect(url!.searchParams.get("agentIds")).toBe("a,b");
    expect(url!.searchParams.get("granularity")).toBe("WEEK");
  });
});
