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

describe("AiService.jobs", () => {
  it("lists jobs at the non-agentic /jobs path", async () => {
    let hit = false;
    server.use(
      http.get(`${BASE}/jobs`, () => {
        hit = true;
        return HttpResponse.json([{ id: "j1", status: "success" }]);
      }),
    );
    expect(await svc().jobs.list()).toEqual([{ id: "j1", status: "success" }]);
    expect(hit).toBe(true);
  });
  it("gets and deletes a job by id", async () => {
    server.use(
      http.get(`${BASE}/jobs/j1`, () => HttpResponse.json({ id: "j1", status: "in_progress" })),
      http.delete(`${BASE}/jobs/j1`, () => new HttpResponse(null, { status: 204 })),
    );
    expect(await svc().jobs.get("j1")).toEqual({ id: "j1", status: "in_progress" });
    await expect(svc().jobs.delete("j1")).resolves.toBeUndefined();
  });
});
