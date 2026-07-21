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

describe("AiService.chatStream", () => {
  it("streams SSE data chunks and forwards the session-id header", async () => {
    let seenSession: string | null = null;
    server.use(
      http.post(`${BASE}/agentic/chat-stream`, ({ request }) => {
        seenSession = request.headers.get("session-id");
        const body = new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode("data: chunk-1\n\n"));
            c.enqueue(new TextEncoder().encode("data: chunk-2\n\n"));
            c.close();
          },
        });
        return new HttpResponse(body, { headers: { "Content-Type": "text/event-stream" } });
      }),
    );
    const chunks: string[] = [];
    for await (const c of svc().chatStream({ agentId: "a", message: "hi" }, { sessionId: "sess-1" })) {
      chunks.push(c);
    }
    expect(chunks).toEqual(["chunk-1", "chunk-2"]);
    expect(seenSession).toBe("sess-1");
  });
});
