import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http as mhttp, HttpResponse } from "msw";
import { HttpClient } from "../src/core/http";
import { LevelResolver } from "../src/core/logger";
import { MemoryLogger } from "./helpers/memory-logger";
import {
  EmporixAuthError,
  EmporixError,
  EmporixServerError,
  EmporixTimeoutError,
  EmporixNetworkError,
} from "../src/core/errors";
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

  it("does not retry POST on 5xx (non-idempotent)", async () => {
    server.use(
      mhttp.post("https://api.emporix.io/orders", () => {
        attempts += 1;
        return HttpResponse.json({ e: 1 }, { status: 503 });
      }),
    );
    await expect(
      client().request({ method: "POST", path: "/orders", auth: { kind: "service" }, body: {} }),
    ).rejects.toBeInstanceOf(EmporixServerError);
    expect(attempts).toBe(1);
  });

  it("does not retry POST on 429", async () => {
    server.use(
      mhttp.post("https://api.emporix.io/orders", () => {
        attempts += 1;
        return HttpResponse.json({ e: 1 }, { status: 429, headers: { "Retry-After": "0" } });
      }),
    );
    await expect(
      client().request({ method: "POST", path: "/orders", auth: { kind: "service" }, body: {} }),
    ).rejects.toBeInstanceOf(EmporixError);
    expect(attempts).toBe(1);
  });

  it("does not retry PATCH on 5xx (non-idempotent by spec)", async () => {
    server.use(
      mhttp.patch("https://api.emporix.io/orders/o1", () => {
        attempts += 1;
        return HttpResponse.json({ e: 1 }, { status: 503 });
      }),
    );
    await expect(
      client().request({ method: "PATCH", path: "/orders/o1", auth: { kind: "service" }, body: {} }),
    ).rejects.toBeInstanceOf(EmporixServerError);
    expect(attempts).toBe(1);
  });

  it("still retries PUT on 5xx (idempotent by spec)", async () => {
    server.use(
      mhttp.put("https://api.emporix.io/orders/o1", () => {
        attempts += 1;
        if (attempts < 3) return HttpResponse.json({ e: 1 }, { status: 503 });
        return HttpResponse.json({ ok: true });
      }),
    );
    const r = await client().request<{ ok: boolean }>({
      method: "PUT", path: "/orders/o1", auth: { kind: "service" }, body: {},
    });
    expect(r.ok).toBe(true);
    expect(attempts).toBe(3);
  });

  it("retries POST on 5xx when explicitly marked idempotent (read-only search endpoints)", async () => {
    server.use(
      mhttp.post("https://api.emporix.io/products/search", () => {
        attempts += 1;
        if (attempts < 3) return HttpResponse.json({ e: 1 }, { status: 503 });
        return HttpResponse.json({ ok: true });
      }),
    );
    const r = await client().request<{ ok: boolean }>({
      method: "POST", path: "/products/search", auth: { kind: "service" }, body: {}, idempotent: true,
    });
    expect(r.ok).toBe(true);
    expect(attempts).toBe(3);
  });

  it("caps a rogue Retry-After at the 8s backoff ceiling", async () => {
    server.use(
      mhttp.get("https://api.emporix.io/rated-long", () => {
        attempts += 1;
        if (attempts < 2) {
          return HttpResponse.json({ e: 1 }, { status: 429, headers: { "Retry-After": "86400" } });
        }
        return HttpResponse.json({ ok: true });
      }),
    );
    const slept: number[] = [];
    const resolver = new LevelResolver({ level: "silent" });
    const c = new HttpClient({
      host: "https://api.emporix.io",
      provider,
      logger: new MemoryLogger(resolver, { service: "http" }),
      retry: { maxAttempts: 3 },
      timeouts: { connectMs: 500, readMs: 500 },
      sleep: (ms) => { slept.push(ms); return Promise.resolve(); },
    });
    const r = await c.request<{ ok: boolean }>({
      method: "GET", path: "/rated-long", auth: { kind: "service" },
    });
    expect(r.ok).toBe(true);
    expect(slept).toEqual([8000]); // 86400s capped to 8000ms
  });

  it("uses exponential backoff with jitter when Retry-After is absent", async () => {
    server.use(
      mhttp.get("https://api.emporix.io/flaky-no-header", () => {
        attempts += 1;
        if (attempts < 3) return HttpResponse.json({ e: 1 }, { status: 503 });
        return HttpResponse.json({ ok: true });
      }),
    );
    const slept: number[] = [];
    const resolver = new LevelResolver({ level: "silent" });
    const c = new HttpClient({
      host: "https://api.emporix.io",
      provider,
      logger: new MemoryLogger(resolver, { service: "http" }),
      retry: { maxAttempts: 3 },
      timeouts: { connectMs: 500, readMs: 500 },
      sleep: (ms) => { slept.push(ms); return Promise.resolve(); },
    });
    const r = await c.request<{ ok: boolean }>({
      method: "GET", path: "/flaky-no-header", auth: { kind: "service" },
    });
    expect(r.ok).toBe(true);
    // attempt 1 → 1000ms + jitter(0-100), attempt 2 → 2000ms + jitter(0-100)
    expect(slept).toHaveLength(2);
    expect(slept[0]).toBeGreaterThanOrEqual(1000);
    expect(slept[0]).toBeLessThan(1100);
    expect(slept[1]).toBeGreaterThanOrEqual(2000);
    expect(slept[1]).toBeLessThan(2100);
  });

  it("wraps an abort timeout in EmporixTimeoutError", async () => {
    server.use(
      mhttp.get("https://api.emporix.io/slow", async () => {
        await new Promise((r) => setTimeout(r, 200));
        return HttpResponse.json({ ok: true });
      }),
    );
    await expect(
      client().request({ method: "GET", path: "/slow", auth: { kind: "service" }, timeoutMs: 30 }),
    ).rejects.toBeInstanceOf(EmporixTimeoutError);
  });

  it("wraps a connection failure in EmporixNetworkError", async () => {
    server.use(
      mhttp.get("https://api.emporix.io/dead", () => HttpResponse.error()),
    );
    await expect(
      client().request({ method: "GET", path: "/dead", auth: { kind: "service" } }),
    ).rejects.toBeInstanceOf(EmporixNetworkError);
  });

  it("bounds the response BODY read by the timeout, not just the headers", async () => {
    // Headers arrive instantly, the body stalls forever: a stream that never closes.
    server.use(
      mhttp.get("https://api.emporix.io/stalled-body", () => {
        const stream = new ReadableStream({ start() { /* never enqueue, never close */ } });
        return new HttpResponse(stream, { headers: { "Content-Type": "application/json" } });
      }),
    );
    await expect(
      client().request({ method: "GET", path: "/stalled-body", auth: { kind: "service" }, timeoutMs: 50 }),
    ).rejects.toBeInstanceOf(EmporixTimeoutError);
  }, 10_000);
});
