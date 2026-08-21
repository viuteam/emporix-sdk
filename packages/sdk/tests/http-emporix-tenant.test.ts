import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http as mhttp, HttpResponse } from "msw";
import { HttpClient } from "../src/core/http";
import { LevelResolver } from "../src/core/logger";
import { MemoryLogger } from "./helpers/memory-logger";
import { auth, type TokenProvider } from "../src/core/auth";

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
    seen = { tenant: request.headers.get("emporix-tenant") };
    return HttpResponse.json({ ok: true });
  }),
);
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  seen = {};
});
afterAll(() => server.close());

function client(opts: { tenant?: string } = {}) {
  const r = new LevelResolver({ level: "silent" });
  return new HttpClient({
    host: "https://api.emporix.io",
    provider,
    logger: new MemoryLogger(r, { service: "product" }),
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
    ...(opts.tenant !== undefined ? { tenant: opts.tenant } : {}),
  });
}

const GET = { method: "GET" as const, path: "/echo", auth: auth.customer("T") };

describe("Emporix-Tenant header", () => {
  it("is sent on every request when the client knows its tenant", async () => {
    await client({ tenant: "acme" }).request(GET);
    expect(seen.tenant).toBe("acme");
  });

  it("is omitted when no tenant is configured", async () => {
    await client().request(GET);
    expect(seen.tenant).toBeNull();
  });

  it("can be overridden per request, like Accept-Language", async () => {
    await client({ tenant: "acme" }).request({ ...GET, headers: { "Emporix-Tenant": "other" } });
    expect(seen.tenant).toBe("other");
  });
});
