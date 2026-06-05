import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { CloudFunctionsService } from "../../src/services/cloud-functions";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";

const FID = "23eef339-6e55-4849-b884-b6643ad01406";
const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon-tok", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function harness() {
  const cfg = {
    tenant: "acme",
    host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "cloud-functions" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new CloudFunctionsService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const CUST = { kind: "customer" as const, token: "cust-tok" };

describe("CloudFunctionsService.invoke", () => {
  it("defaults to POST with anonymous auth, forwards the body, returns parsed JSON", async () => {
    let captured: { method: string; auth: string | null; body: unknown } | null = null;
    server.use(
      http.post(`https://api.emporix.io/cloud-functions/acme/functions/${FID}`, async ({ request }) => {
        captured = {
          method: request.method,
          auth: request.headers.get("authorization"),
          body: await request.json(),
        };
        return HttpResponse.json({ greeting: "Hello John" });
      }),
    );
    const res = await harness().invoke<{ greeting: string }>(FID, { body: { name: "John" } });
    expect(res.greeting).toBe("Hello John");
    expect(captured!.method).toBe("POST");
    expect(captured!.auth).toBe("Bearer anon-tok");
    expect(captured!.body).toEqual({ name: "John" });
  });

  it("supports GET and forwards query params", async () => {
    let url = "";
    server.use(
      http.get(`https://api.emporix.io/cloud-functions/acme/functions/${FID}`, ({ request }) => {
        url = request.url;
        return HttpResponse.json({ ok: true });
      }),
    );
    await harness().invoke(FID, { method: "GET", query: { page: 2 } }, CUST);
    expect(new URL(url).searchParams.get("page")).toBe("2");
  });

  it("appends a sub-path (leading slash optional)", async () => {
    let hit = false;
    server.use(
      http.post(`https://api.emporix.io/cloud-functions/acme/functions/${FID}/products`, () => {
        hit = true;
        return HttpResponse.json({ ok: true });
      }),
    );
    await harness().invoke(FID, { path: "/products" });
    expect(hit).toBe(true);
  });

  it("uses the customer token when customer auth is passed", async () => {
    let authHeader: string | null = null;
    server.use(
      http.post(`https://api.emporix.io/cloud-functions/acme/functions/${FID}`, ({ request }) => {
        authHeader = request.headers.get("authorization");
        return HttpResponse.json({ ok: true });
      }),
    );
    await harness().invoke(FID, {}, CUST);
    expect(authHeader).toBe("Bearer cust-tok");
  });

  it("propagates a 403 as a thrown error", async () => {
    server.use(
      http.post(`https://api.emporix.io/cloud-functions/acme/functions/${FID}`, () =>
        HttpResponse.json({ message: "forbidden" }, { status: 403 }),
      ),
    );
    await expect(harness().invoke(FID, {}, CUST)).rejects.toThrow();
  });

  it("resolves to undefined on an empty 204", async () => {
    server.use(
      http.post(`https://api.emporix.io/cloud-functions/acme/functions/${FID}`,
        () => new HttpResponse(null, { status: 204 })),
    );
    await expect(harness().invoke(FID, {}, CUST)).resolves.toBeUndefined();
  });
});
