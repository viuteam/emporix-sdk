import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { SepaExportService } from "../../src/services/sepa-export";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { EmporixNotFoundError } from "../../src/core/errors";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "sepa-export" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new SepaExportService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/sepa-export/acme";

describe("SepaExportService", () => {
  it("getFile returns the raw file text with a service token", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(`${BASE}/files/f1`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return new HttpResponse("<SEPA>xml</SEPA>", { headers: { "Content-Type": "text/plain" } });
      }),
    );
    const text = await svc().getFile("f1");
    expect(seenAuth).toBe("Bearer svc-tok");
    expect(text).toBe("<SEPA>xml</SEPA>");
  });

  it("getFile throws EmporixNotFoundError on 404", async () => {
    server.use(http.get(`${BASE}/files/NOPE`, () => new HttpResponse(null, { status: 404 })));
    await expect(svc().getFile("NOPE")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("listJobs GETs the jobs array", async () => {
    server.use(http.get(`${BASE}/jobs`, () => HttpResponse.json([{ id: "j1" }])));
    expect(await svc().listJobs()).toHaveLength(1);
  });

  it("createJob POSTs the body and returns the created id", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/jobs`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "j1" }, { status: 201 });
      }),
    );
    const res = await svc().createJob({ type: "CREDIT_TRANSFER" } as never);
    expect(body).toEqual({ type: "CREDIT_TRANSFER" });
    expect((res as { id?: string }).id).toBe("j1");
  });

  it("encodeURIComponent-escapes the file id", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/sepa-export/acme/files/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return new HttpResponse("x", { headers: { "Content-Type": "text/plain" } });
      }),
    );
    await svc().getFile("a/b");
    expect(pathname).toBe("/sepa-export/acme/files/a%2Fb");
  });
});
