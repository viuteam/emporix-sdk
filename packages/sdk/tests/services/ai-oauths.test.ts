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

describe("AiService.oauths", () => {
  it("lists with expand + paging forwarded as query", async () => {
    let url: URL | null = null;
    server.use(
      http.get(`${BASE}/agentic/oauths`, ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json([{ id: "gh" }]);
      }),
    );
    const res = await svc().oauths.list({ expand: "token", pageSize: 10 });
    expect(res).toEqual([{ id: "gh" }]);
    expect(url!.searchParams.get("expand")).toBe("token");
    expect(url!.searchParams.get("pageSize")).toBe("10");
  });

  it("upsert returns { id } on 201 create", async () => {
    server.use(
      http.put(`${BASE}/agentic/oauths/gh`, () => HttpResponse.json({ id: "gh" }, { status: 201 })),
    );
    const created = await svc().oauths.upsert("gh", {
      url: "https://example.com/token",
      clientId: "cid",
      grantType: "client_credentials",
    });
    expect(created).toEqual({ id: "gh" });
  });

  it("upsert returns undefined on 204 update and forwards ?force", async () => {
    let url: URL | null = null;
    server.use(
      http.put(`${BASE}/agentic/oauths/gh`, ({ request }) => {
        url = new URL(request.url);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const res = await svc().oauths.upsert(
      "gh",
      { url: "https://example.com/token", clientId: "cid", grantType: "client_credentials" },
      { force: true },
    );
    expect(res).toBeUndefined();
    expect(url!.searchParams.get("force")).toBe("true");
  });

  it("patch sends the UPPERCASE op array verbatim", async () => {
    let body: unknown = null;
    server.use(
      http.patch(`${BASE}/agentic/oauths/gh`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await svc().oauths.patch("gh", [{ op: "REPLACE", path: "/enabled", value: "false" }]);
    expect(body).toEqual([{ op: "REPLACE", path: "/enabled", value: "false" }]);
  });

  it("delete forwards ?force=true", async () => {
    let url: URL | null = null;
    server.use(
      http.delete(`${BASE}/agentic/oauths/gh`, ({ request }) => {
        url = new URL(request.url);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await svc().oauths.delete("gh", { force: true });
    expect(url!.searchParams.get("force")).toBe("true");
  });

  it("search posts { q } to /search", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/agentic/oauths/search`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json([{ id: "gh" }]);
      }),
    );
    const res = await svc().oauths.search({ q: "grantType:client_credentials" });
    expect(res).toEqual([{ id: "gh" }]);
    expect(body).toEqual({ q: "grantType:client_credentials" });
  });
});
