import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { AiService } from "../../src/services/ai";
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

describe("AiService", () => {
  it("generateText POSTs the prompt with a service token and returns the result", async () => {
    let seenAuth: string | null = null;
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/texts`, async ({ request }) => {
        seenAuth = request.headers.get("authorization");
        body = await request.json();
        return HttpResponse.json({ id: "t1", result: "hello world" });
      }),
    );
    const res = await svc().generateText({ prompt: "say hi", maxTokens: 16 });
    expect(seenAuth).toBe("Bearer svc-tok");
    expect(body).toEqual({ prompt: "say hi", maxTokens: 16 });
    expect(res.result).toBe("hello world");
  });

  it("complete POSTs the messages array and returns the result", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/completions`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "c1", result: "answer" });
      }),
    );
    const res = await svc().complete({ messages: [{ role: "USER", content: "hi" }] });
    expect(body).toEqual({ messages: [{ role: "USER", content: "hi" }] });
    expect(res.result).toBe("answer");
  });

  it("listAgents GETs the agent array", async () => {
    server.use(
      http.get(`${BASE}/agentic/agents`, () =>
        HttpResponse.json([{ id: "a1", name: "Support" }, { id: "a2", name: "Sales" }]),
      ),
    );
    const agents = await svc().listAgents();
    expect(agents.map((a) => (a as { id: string }).id)).toEqual(["a1", "a2"]);
  });

  it("getAgent fetches one agent by id", async () => {
    server.use(
      http.get(`${BASE}/agentic/agents/a1`, () => HttpResponse.json({ id: "a1", name: "Support" })),
    );
    const a = await svc().getAgent("a1");
    expect((a as { id: string }).id).toBe("a1");
  });

  it("getAgent throws EmporixNotFoundError on 404", async () => {
    server.use(
      http.get(`${BASE}/agentic/agents/missing`, () =>
        HttpResponse.json({ status: 404, message: "not found" }, { status: 404 }),
      ),
    );
    await expect(svc().getAgent("missing")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("upsertAgent PUTs the agent and returns it", async () => {
    let body: unknown = null;
    server.use(
      http.put(`${BASE}/agentic/agents/a1`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "a1", name: "Support" });
      }),
    );
    const a = await svc().upsertAgent("a1", { id: "a1", name: "Support" } as never);
    expect(body).toEqual({ id: "a1", name: "Support" });
    expect((a as unknown as { name: string }).name).toBe("Support");
  });

  it("patchAgent PATCHes the UPPERCASE op array verbatim", async () => {
    let body: unknown = null;
    server.use(
      http.patch(`${BASE}/agentic/agents/a1`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "a1", name: "Renamed" });
      }),
    );
    const a = await svc().patchAgent("a1", [{ op: "REPLACE", path: "/name", value: "Renamed" }]);
    expect(body).toEqual([{ op: "REPLACE", path: "/name", value: "Renamed" }]);
    expect((a as unknown as { name: string }).name).toBe("Renamed");
  });

  it("searchAgents POSTs the query to /agentic/agents/search", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/agentic/agents/search`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json([{ id: "a1", name: "Support" }]);
      }),
    );
    const found = await svc().searchAgents({ q: "Sup" } as never);
    expect(body).toEqual({ q: "Sup" });
    expect(found).toHaveLength(1);
  });

  it("deleteAgent DELETEs and resolves to void (no force query by default)", async () => {
    let search = "x";
    server.use(
      http.delete(`${BASE}/agentic/agents/a1`, ({ request }) => {
        search = new URL(request.url).search;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(svc().deleteAgent("a1")).resolves.toBeUndefined();
    expect(search).toBe("");
  });

  it("deleteAgent passes ?force=true when forced", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.delete(`${BASE}/agentic/agents/a1`, ({ request }) => {
        q = new URL(request.url).searchParams;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await svc().deleteAgent("a1", undefined, { force: true });
    expect((q as URLSearchParams | null)?.get("force")).toBe("true");
  });

  it("chat returns the ChatResponse ARRAY (not unwrapped)", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/agentic/chat`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json([
          { agentId: "a1", agentType: "support", sessionId: "s1", message: "hi there" },
        ]);
      }),
    );
    const out = await svc().chat({ agentId: "a1", message: "hi" });
    expect(body).toEqual({ agentId: "a1", message: "hi" });
    expect(Array.isArray(out)).toBe(true);
    expect(out[0]?.sessionId).toBe("s1");
  });

  it("chatAsync returns the JobIdResponse ARRAY on HTTP 201", async () => {
    server.use(
      http.post(`${BASE}/agentic/chat-async`, () =>
        HttpResponse.json([{ jobId: "job-1" }], { status: 201 }),
      ),
    );
    const out = await svc().chatAsync({ agentId: "a1", message: "hi" });
    expect(Array.isArray(out)).toBe(true);
    expect(out[0]?.jobId).toBe("job-1");
  });

  it("encodeURIComponent-escapes the agent id in the path", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/ai-service/acme/agentic/agents/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({ id: "a/b" });
      }),
    );
    await svc().getAgent("a/b");
    expect(pathname).toBe("/ai-service/acme/agentic/agents/a%2Fb");
  });
});
