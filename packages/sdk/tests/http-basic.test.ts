import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http as mhttp, HttpResponse } from "msw";
import { HttpClient } from "../src/core/http";
import { LevelResolver } from "../src/core/logger";
import { MemoryLogger } from "./helpers/memory-logger";
import { EmporixNotFoundError, EmporixValidationError } from "../src/core/errors";
import type { TokenProvider } from "../src/core/auth";

const provider: TokenProvider = {
  getToken: async () => "SVC-TOKEN",
  getAnonymousToken: async () => ({
    accessToken: "ANON", refreshToken: "r", sessionId: "s", expiresIn: 3599,
  }),
};

let seenAuth = "";
const server = setupServer(
  mhttp.get("https://api.emporix.io/ok", ({ request }) => {
    seenAuth = request.headers.get("authorization") ?? "";
    return HttpResponse.json({ hello: "world" });
  }),
  mhttp.get("https://api.emporix.io/missing", () =>
    HttpResponse.json({ error: "nope" }, { status: 404 }),
  ),
  mhttp.post("https://api.emporix.io/bad", () =>
    HttpResponse.json({ error: "bad" }, { status: 422 }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  seenAuth = "";
});
afterAll(() => server.close());

function makeClient() {
  const resolver = new LevelResolver({ level: "trace" });
  const logger = new MemoryLogger(resolver, { service: "http" });
  return {
    logger,
    client: new HttpClient({
      host: "https://api.emporix.io",
      provider,
      logger,
      retry: { maxAttempts: 3 },
      timeouts: { connectMs: 1000, readMs: 1000 },
    }),
  };
}

describe("HttpClient", () => {
  it("resolves AuthContext into a Bearer header and parses JSON", async () => {
    const { client } = makeClient();
    const r = await client.request<{ hello: string }>({
      method: "GET", path: "/ok", auth: { kind: "service" },
    });
    expect(r.hello).toBe("world");
    expect(seenAuth).toBe("Bearer SVC-TOKEN");
  });

  it("maps 404 → EmporixNotFoundError, 422 → EmporixValidationError", async () => {
    const { client } = makeClient();
    await expect(
      client.request({ method: "GET", path: "/missing", auth: { kind: "service" } }),
    ).rejects.toBeInstanceOf(EmporixNotFoundError);
    await expect(
      client.request({ method: "POST", path: "/bad", auth: { kind: "service" } }),
    ).rejects.toBeInstanceOf(EmporixValidationError);
  });

  it("logs the auth kind but never the token value", async () => {
    const { client, logger } = makeClient();
    await client.request({ method: "GET", path: "/ok", auth: { kind: "service" } });
    const dump = JSON.stringify(logger.entries);
    expect(dump).not.toContain("SVC-TOKEN");
    expect(dump).toContain("service");
  });
});
