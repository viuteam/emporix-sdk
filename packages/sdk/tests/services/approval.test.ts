import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { ApprovalService } from "../../src/services/approval";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "approval" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new ApprovalService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const CUST = { kind: "customer", token: "cust-tok" } as const;
const BASE = "https://api.emporix.io/approval/acme";

describe("ApprovalService", () => {
  it("listApprovals GETs /approvals with the customer token + query", async () => {
    let seenAuth: string | null = null;
    let search = "";
    server.use(
      http.get(`${BASE}/approvals`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        search = new URL(request.url).search;
        return HttpResponse.json([{ id: "a1" }]);
      }),
    );
    const out = await svc().listApprovals({ pageSize: 10, q: "status:PENDING" }, CUST);
    expect(out).toEqual([{ id: "a1" }]);
    expect(seenAuth).toBe("Bearer cust-tok");
    expect(search).toContain("pageSize=10");
    expect(search).toContain("q=status%3APENDING");
  });

  it("getApproval GETs /approvals/{id}", async () => {
    server.use(http.get(`${BASE}/approvals/a1`, () => HttpResponse.json({ id: "a1" })));
    expect((await svc().getApproval("a1", CUST)) as { id?: string }).toEqual({ id: "a1" });
  });

  it("createApproval POSTs the body and returns the created id", async () => {
    let body: unknown = null;
    server.use(
      http.post(`${BASE}/approvals`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "a1" }, { status: 201 });
      }),
    );
    const created = await svc().createApproval({ resource: { resourceType: "CART" } } as never, CUST);
    expect(created.id).toBe("a1");
    expect(body).toEqual({ resource: { resourceType: "CART" } });
  });

  it("updateApproval PATCHes a JSON-Patch op-array and resolves to void", async () => {
    let body: unknown = null;
    server.use(
      http.patch(`${BASE}/approvals/a1`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const ops = [{ op: "replace", path: "/status", value: "APPROVED" }] as never;
    await expect(svc().updateApproval("a1", ops, CUST)).resolves.toBeUndefined();
    expect(body).toEqual([{ op: "replace", path: "/status", value: "APPROVED" }]);
  });

  it("deleteApproval DELETEs and resolves to void", async () => {
    server.use(http.delete(`${BASE}/approvals/a1`, () => new HttpResponse(null, { status: 204 })));
    await expect(svc().deleteApproval("a1", CUST)).resolves.toBeUndefined();
  });

  it("checkPermitted POSTs /approval/permitted and returns the permitted flag", async () => {
    server.use(
      http.post(`${BASE}/approval/permitted`, () =>
        HttpResponse.json({ permitted: true, action: "CREATE" }),
      ),
    );
    const out = await svc().checkPermitted({ resourceType: "CART", resourceId: "c1" } as never, CUST);
    expect(out.permitted).toBe(true);
  });

  it("searchApprovers POSTs /search/users and returns an array", async () => {
    server.use(http.post(`${BASE}/search/users`, () => HttpResponse.json([{ id: "u1" }])));
    const out = await svc().searchApprovers({ resourceType: "CART", resourceId: "c1" } as never, CUST);
    expect(out).toEqual([{ id: "u1" }]);
  });

  it("getApproval throws EmporixNotFoundError on 404", async () => {
    server.use(
      http.get(`${BASE}/approvals/NOPE`, () =>
        HttpResponse.json({ status: 404, message: "x" }, { status: 404 }),
      ),
    );
    await expect(svc().getApproval("NOPE", CUST)).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("encodeURIComponent-escapes the approval id", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/approval/acme/approvals/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({});
      }),
    );
    await svc().getApproval("a/b", CUST);
    expect(pathname).toBe("/approval/acme/approvals/a%2Fb");
  });
});
