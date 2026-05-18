import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http as mhttp, HttpResponse } from "msw";
import { HttpClient } from "../src/core/http";
import { LevelResolver } from "../src/core/logger";
import { MemoryLogger } from "./helpers/memory-logger";
import { EmporixAuthError } from "../src/core/errors";
import type { TokenProvider } from "../src/core/auth";

let invalidated = 0;
const provider: TokenProvider = {
  getToken: async () => `svc-${invalidated}`,
  getAnonymousToken: async () => ({
    accessToken: "anon", refreshToken: "r", sessionId: "s", expiresIn: 3599,
  }),
  invalidate: () => {
    invalidated += 1;
  },
};

let attempts = 0;
let customerCalls = 0;
const server = setupServer(
  mhttp.get("https://api.emporix.io/flaky", () => {
    attempts += 1;
    if (attempts < 3) return HttpResponse.json({ e: 1 }, { status: 503 });
    return HttpResponse.json({ ok: true });
  }),
  mhttp.get("https://api.emporix.io/rated", () =>
    HttpResponse.json({ e: 1 }, { status: 429, headers: { "Retry-After": "0" } }),
  ),
  mhttp.get("https://api.emporix.io/svc401", () => {
    attempts += 1;
    if (attempts === 1) return HttpResponse.json({ e: 1 }, { status: 401 });
    return HttpResponse.json({ ok: true });
  }),
  mhttp.get("https://api.emporix.io/cust401", () => {
    customerCalls += 1;
    return HttpResponse.json({ e: 1 }, { status: 401 });
  }),
);
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  attempts = 0;
  customerCalls = 0;
  invalidated = 0;
});
afterAll(() => server.close());

function client() {
  const r = new LevelResolver({ level: "silent" });
  return new HttpClient({
    host: "https://api.emporix.io",
    provider,
    logger: new MemoryLogger(r, { service: "http" }),
    retry: { maxAttempts: 3 },
    timeouts: { connectMs: 500, readMs: 500 },
    sleep: () => Promise.resolve(), // no real backoff delay in tests
  });
}

describe("HttpClient retry + 401 asymmetry", () => {
  it("retries 5xx with backoff until success", async () => {
    const r = await client().request<{ ok: boolean }>({
      method: "GET", path: "/flaky", auth: { kind: "service" },
    });
    expect(r.ok).toBe(true);
    expect(attempts).toBe(3);
  });

  it("retries 429 respecting Retry-After then exhausts to a typed error", async () => {
    await expect(
      client().request({ method: "GET", path: "/rated", auth: { kind: "service" } }),
    ).rejects.toThrow();
  });

  it("SDK-managed 401 invalidates, refreshes and retries once", async () => {
    const r = await client().request<{ ok: boolean }>({
      method: "GET", path: "/svc401", auth: { kind: "service" },
    });
    expect(r.ok).toBe(true);
    expect(invalidated).toBe(1);
  });

  it("caller-managed 401 throws immediately, no retry", async () => {
    await expect(
      client().request({
        method: "GET", path: "/cust401", auth: { kind: "customer", token: "C" },
      }),
    ).rejects.toBeInstanceOf(EmporixAuthError);
    expect(customerCalls).toBe(1);
  });
});
