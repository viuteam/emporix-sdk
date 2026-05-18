import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http as mhttp, HttpResponse } from "msw";
import { HttpClient } from "../src/core/http";
import { LevelResolver, redact } from "../src/core/logger";
import { MemoryLogger } from "./helpers/memory-logger";
import type { TokenProvider } from "../src/core/auth";

const provider: TokenProvider = {
  getToken: async () => "SVC",
  getAnonymousToken: async () => ({
    accessToken: "ANON", refreshToken: "r", sessionId: "s", expiresIn: 3599,
  }),
};

let seen: Record<string, string | null> = {};
const server = setupServer(
  mhttp.post("https://api.emporix.io/echo", ({ request }) => {
    seen = {
      auth: request.headers.get("authorization"),
      saas: request.headers.get("saas-token"),
    };
    return HttpResponse.json({ ok: true });
  }),
);
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  seen = {};
});
afterAll(() => server.close());

function client() {
  const r = new LevelResolver({ level: "silent" });
  return new HttpClient({
    host: "https://api.emporix.io",
    provider,
    logger: new MemoryLogger(r, { service: "checkout" }),
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
}

describe("HttpClient custom headers", () => {
  it("merges RequestOptions.headers into the request", async () => {
    await client().request({
      method: "POST",
      path: "/echo",
      auth: { kind: "customer", token: "CUST" },
      headers: { "saas-token": "SAAS-JWT" },
      body: {},
    });
    expect(seen.auth).toBe("Bearer CUST");
    expect(seen.saas).toBe("SAAS-JWT");
  });

  it("never lets a custom header override Authorization", async () => {
    await client().request({
      method: "POST",
      path: "/echo",
      auth: { kind: "customer", token: "CUST" },
      headers: { Authorization: "Bearer HACK" },
      body: {},
    });
    expect(seen.auth).toBe("Bearer CUST");
  });
});

describe("redact", () => {
  it("masks the saas-token header key", () => {
    expect(redact({ "saas-token": "SAAS-JWT", keep: 1 })).toEqual({
      "saas-token": "***redacted***",
      keep: 1,
    });
  });
});
