import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { DefaultTokenProvider } from "../src/core/auth";
import { EmporixAuthError } from "../src/core/errors";

let hits = 0;
const server = setupServer(
  http.post("https://api.emporix.io/oauth/token", async ({ request }) => {
    const body = new URLSearchParams(await request.text());
    if (body.get("client_secret") === "bad") {
      return HttpResponse.json({ error: "invalid_client" }, { status: 401 });
    }
    hits += 1;
    return HttpResponse.json({
      access_token: `tok-${body.get("client_id")}-${hits}`,
      token_type: "Bearer",
      expires_in: 3600,
    });
  }),
);
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  hits = 0;
});
afterAll(() => server.close());

const cfg = {
  host: "https://api.emporix.io",
  credentials: {
    backend: { clientId: "b", secret: "s" },
    custom: { partner: { clientId: "p", secret: "s", scope: "x" } },
  },
  cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
};

describe("DefaultTokenProvider service path", () => {
  it("fetches, caches per credential set, and reuses within TTL", async () => {
    const p = new DefaultTokenProvider(cfg as never);
    const a = await p.getToken("backend");
    const b = await p.getToken("backend");
    expect(a).toBe("tok-b-1");
    expect(b).toBe("tok-b-1"); // cached, no second hit
    expect(await p.getToken("partner")).toBe("tok-p-2");
  });

  it("concurrent calls share a single in-flight request", async () => {
    const p = new DefaultTokenProvider(cfg as never);
    const [x, y] = await Promise.all([p.getToken("backend"), p.getToken("backend")]);
    expect(x).toBe(y);
    expect(hits).toBe(1);
  });

  it("invalidate forces a refetch", async () => {
    const p = new DefaultTokenProvider(cfg as never);
    await p.getToken("backend");
    p.invalidate("backend");
    expect(await p.getToken("backend")).toBe("tok-b-2");
  });

  it("throws EmporixAuthError on 4xx", async () => {
    const bad = { ...cfg, credentials: { backend: { clientId: "b", secret: "bad" } } };
    const p = new DefaultTokenProvider(bad as never);
    await expect(p.getToken("backend")).rejects.toBeInstanceOf(EmporixAuthError);
  });

  it("throws for an unknown credential set", async () => {
    const p = new DefaultTokenProvider(cfg as never);
    await expect(p.getToken("nope")).rejects.toThrow(/credential set/i);
  });
});
