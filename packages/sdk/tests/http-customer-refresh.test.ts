import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http as mhttp, HttpResponse } from "msw";
import { HttpClient } from "../src/core/http";
import { CustomerRefreshRegistry } from "../src/core/auth";
import { LevelResolver } from "../src/core/logger";
import { MemoryLogger } from "./helpers/memory-logger";
import { EmporixAuthError } from "../src/core/errors";
import type { TokenProvider } from "../src/core/auth";

const provider = {
  getToken: async () => "svc",
  getAnonymousToken: async () => ({
    accessToken: "anon", refreshToken: "r", sessionId: "s", expiresIn: 3599,
  }),
} as unknown as TokenProvider;

let seenTokens: string[] = [];
const server = setupServer(
  mhttp.get("https://api.emporix.io/cust", ({ request }) => {
    const tok = request.headers.get("authorization");
    seenTokens.push(tok ?? "");
    if (tok === "Bearer OLD") return HttpResponse.json({ e: 1 }, { status: 401 });
    return HttpResponse.json({ ok: true });
  }),
);
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  seenTokens = [];
});
afterAll(() => server.close());

function client(registry?: CustomerRefreshRegistry) {
  const r = new LevelResolver({ level: "silent" });
  return new HttpClient({
    host: "https://api.emporix.io",
    provider,
    logger: new MemoryLogger(r, { service: "http" }),
    retry: { maxAttempts: 3 },
    timeouts: { connectMs: 500, readMs: 500 },
    sleep: () => Promise.resolve(),
    ...(registry ? { customerRefresh: registry } : {}),
  });
}

describe("HttpClient customer-token auto-refresh", () => {
  it("refreshes once on a customer 401 and retries with the new token", async () => {
    const reg = new CustomerRefreshRegistry();
    let calls = 0;
    reg.set({
      refresh: async () => {
        calls += 1;
        return "NEW";
      },
    });
    const r = await client(reg).request<{ ok: boolean }>({
      method: "GET", path: "/cust", auth: { kind: "customer", token: "OLD" },
    });
    expect(r.ok).toBe(true);
    expect(calls).toBe(1);
    expect(seenTokens).toEqual(["Bearer OLD", "Bearer NEW"]);
  });

  it("propagates the 401 when the refresher returns null", async () => {
    const reg = new CustomerRefreshRegistry();
    reg.set({ refresh: async () => null });
    await expect(
      client(reg).request({ method: "GET", path: "/cust", auth: { kind: "customer", token: "OLD" } }),
    ).rejects.toBeInstanceOf(EmporixAuthError);
    expect(seenTokens).toEqual(["Bearer OLD"]);
  });

  it("retries at most once (a still-stale refreshed token does not loop)", async () => {
    const reg = new CustomerRefreshRegistry();
    let calls = 0;
    reg.set({
      refresh: async () => {
        calls += 1;
        return "OLD"; // still 401s
      },
    });
    await expect(
      client(reg).request({ method: "GET", path: "/cust", auth: { kind: "customer", token: "OLD" } }),
    ).rejects.toBeInstanceOf(EmporixAuthError);
    expect(calls).toBe(1);
    expect(seenTokens).toEqual(["Bearer OLD", "Bearer OLD"]);
  });

  it("without a registry, a customer 401 throws immediately (default off)", async () => {
    await expect(
      client().request({ method: "GET", path: "/cust", auth: { kind: "customer", token: "OLD" } }),
    ).rejects.toBeInstanceOf(EmporixAuthError);
    expect(seenTokens).toEqual(["Bearer OLD"]);
  });
});
