import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { AiService } from "../../src/services/ai";
import type { SearchQuery } from "../../src/services/ai";
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

// All ten search operations of the AI service spec, each with the method that wraps it.
const SEARCHES: [string, string, (ai: AiService, q: SearchQuery) => Promise<unknown>][] = [
  ["searchAgents", "/agentic/agents/search", (ai, q) => ai.searchAgents(q)],
  ["searchConversations", "/agentic/conversations/search", (ai, q) => ai.searchConversations(q)],
  ["tools.search", "/agentic/tools/search", (ai, q) => ai.tools.search(q)],
  ["tokens.search", "/agentic/tokens/search", (ai, q) => ai.tokens.search(q)],
  ["oauths.search", "/agentic/oauths/search", (ai, q) => ai.oauths.search(q)],
  ["mcpServers.search", "/agentic/mcp-servers/search", (ai, q) => ai.mcpServers.search(q)],
  ["templates.search", "/agentic/templates/search", (ai, q) => ai.templates.search(q)],
  ["jobs.search", "/jobs/search", (ai, q) => ai.jobs.search(q)],
  ["logs.searchRequests", "/agentic/logs/requests/search", (ai, q) => ai.logs.searchRequests(q)],
  ["logs.searchSessions", "/agentic/logs/sessions/search", (ai, q) => ai.logs.searchSessions(q)],
];

describe("AI search paging", () => {
  it.each(SEARCHES)(
    "%s sends paging, sort and fields as query parameters, only q in the body, and nothing extra when unset",
    async (_name, path, call) => {
      const seen: { query: Record<string, string>; body: unknown }[] = [];
      server.use(
        http.post(`${BASE}${path}`, async ({ request }) => {
          seen.push({
            query: Object.fromEntries(new URL(request.url).searchParams),
            body: await request.json(),
          });
          return HttpResponse.json([]);
        }),
      );
      const ai = svc();
      await call(ai, { q: "name:~Complaint", pageNumber: 2, pageSize: 50, sort: "_id:DESC", fields: "id,name" });
      await call(ai, { q: "name:~Complaint" });
      expect(seen).toEqual([
        {
          query: { pageNumber: "2", pageSize: "50", sort: "_id:DESC", fields: "id,name" },
          body: { q: "name:~Complaint" },
        },
        { query: {}, body: { q: "name:~Complaint" } },
      ]);
    },
  );
});
