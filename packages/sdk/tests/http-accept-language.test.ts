import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http as mhttp, HttpResponse } from "msw";
import { HttpClient } from "../src/core/http";
import { LevelResolver } from "../src/core/logger";
import { MemoryLogger } from "./helpers/memory-logger";
import type { TokenProvider } from "../src/core/auth";

const provider: TokenProvider = {
  getToken: async () => "SVC",
  getAnonymousToken: async () => ({
    accessToken: "ANON",
    refreshToken: "r",
    sessionId: "s",
    expiresIn: 3599,
  }),
};

let seen: Record<string, string | null> = {};
const server = setupServer(
  mhttp.get("https://api.emporix.io/echo", ({ request }) => {
    seen = { acceptLanguage: request.headers.get("accept-language") };
    return HttpResponse.json({ ok: true });
  }),
);
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  seen = {};
});
afterAll(() => server.close());

function client(requestContext?: { language?: string }) {
  const r = new LevelResolver({ level: "silent" });
  return new HttpClient({
    host: "https://api.emporix.io",
    provider,
    logger: new MemoryLogger(r, { service: "checkout" }),
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
    ...(requestContext ? { requestContext } : {}),
  });
}

describe("HttpClient Accept-Language", () => {
  it("injects Accept-Language from requestContext.language", async () => {
    await client({ language: "de" }).request({
      method: "GET",
      path: "/echo",
      auth: { kind: "anonymous" },
    });
    expect(seen.acceptLanguage).toBe("de");
  });

  it("omits Accept-Language when no language is set", async () => {
    await client().request({
      method: "GET",
      path: "/echo",
      auth: { kind: "anonymous" },
    });
    expect(seen.acceptLanguage).toBeNull();
  });

  it("lets a per-request header override the context language", async () => {
    await client({ language: "de" }).request({
      method: "GET",
      path: "/echo",
      auth: { kind: "anonymous" },
      headers: { "Accept-Language": "fr" },
    });
    expect(seen.acceptLanguage).toBe("fr");
  });
});
