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

const BASE = "https://api.emporix.io/ai-service/acme/agentic";
const CUST = { kind: "customer", token: "cust-tok" } as const;

function record(path: string) {
  const seen: { query: Record<string, string>; auth: string | null }[] = [];
  server.use(
    http.get(`${BASE}/${path}`, ({ request }) => {
      seen.push({
        query: Object.fromEntries(new URL(request.url).searchParams),
        auth: request.headers.get("authorization"),
      });
      return HttpResponse.json([]);
    }),
  );
  return seen;
}

// Both shapes: the original `(auth)` call, and `(query, auth)`. An auth context
// passed first must never reach the query string, where its token would sit in the URL.
const EXPECTED = [
  { query: {}, auth: "Bearer svc-tok" },
  { query: { q: "name:bot", pageNumber: "2", pageSize: "50" }, auth: "Bearer svc-tok" },
  { query: {}, auth: "Bearer cust-tok" },
  { query: { pageNumber: "3" }, auth: "Bearer cust-tok" },
];

describe("AiService list paging", () => {
  it("listAgents takes a query, and still takes auth alone", async () => {
    const seen = record("agents");
    const ai = svc();
    await ai.listAgents();
    await ai.listAgents({ q: "name:bot", pageNumber: 2, pageSize: 50 });
    await ai.listAgents(CUST);
    await ai.listAgents({ pageNumber: 3 }, CUST);
    expect(seen).toEqual(EXPECTED);
  });

  it("listConversations takes a query, and still takes auth alone", async () => {
    const seen = record("conversations");
    const ai = svc();
    await ai.listConversations();
    await ai.listConversations({ q: "name:bot", pageNumber: 2, pageSize: 50 });
    await ai.listConversations(CUST);
    await ai.listConversations({ pageNumber: 3 }, CUST);
    expect(seen).toEqual(EXPECTED);
  });
});
