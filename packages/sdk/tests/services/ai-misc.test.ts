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

describe("AiService.listModels / listCommerceEvents", () => {
  it("lists models", async () => {
    server.use(http.get(`${BASE}/agentic/models`, () => HttpResponse.json([{ provider: "openai", models: ["gpt-x"] }])));
    expect(await svc().listModels()).toEqual([{ provider: "openai", models: ["gpt-x"] }]);
  });
  it("lists commerce events", async () => {
    server.use(http.get(`${BASE}/agentic/commerce-events`, () => HttpResponse.json({ events: ["order.created"] })));
    expect(await svc().listCommerceEvents()).toEqual({ events: ["order.created"] });
  });
});

describe("AiService.uploadAttachment", () => {
  it("posts multipart form data and forwards session-id", async () => {
    let contentType: string | null = null;
    let sessionId: string | null = null;
    let fieldPresent = false;
    server.use(
      http.post(`${BASE}/agentic/bot/attachments`, async ({ request }) => {
        contentType = request.headers.get("content-type");
        sessionId = request.headers.get("session-id");
        const fd = await request.formData();
        fieldPresent = fd.has("attachment");
        return HttpResponse.json({ id: "att-1", sessionId: "sess-9" }, { status: 201 });
      }),
    );
    const res = await svc().uploadAttachment("bot", new Blob(["hello"], { type: "text/plain" }), {
      sessionId: "sess-9",
    });
    expect(res).toEqual({ id: "att-1", sessionId: "sess-9" });
    expect(contentType).toMatch(/multipart\/form-data/);
    expect(sessionId).toBe("sess-9");
    expect(fieldPresent).toBe(true);
  });
});

describe("AiService.exportAgents / importAgents", () => {
  it("exports the given agent ids", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/agentic/agents/export`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ data: "eyJ...", checksum: "abc" });
      }),
    );
    const res = await svc().exportAgents({ agentIds: ["a", "b"] });
    expect(res).toEqual({ data: "eyJ...", checksum: "abc" });
    expect(body).toEqual({ agentIds: ["a", "b"] });
  });
  it("imports a data+checksum blob", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/agentic/agents/import`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "a" });
      }),
    );
    const res = await svc().importAgents({ data: "eyJ...", checksum: "abc" });
    expect(res).toEqual({ id: "a" });
    expect(body).toEqual({ data: "eyJ...", checksum: "abc" });
  });
});
