import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { CompaniesService } from "../../src/services/companies";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";
import {
  EmporixForbiddenError,
  EmporixInsufficientScopeError,
} from "../../src/core/errors";

const server = setupServer();
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "customer-management" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new CompaniesService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const CUST = { kind: "customer" as const, token: "cust-tok" };

describe("CompaniesService", () => {
  it("listMine GETs legal-entities with the customer Bearer", async () => {
    let auth: string | null = null;
    server.use(
      http.get("https://api.emporix.io/customer-management/acme/legal-entities", ({ request }) => {
        auth = request.headers.get("authorization");
        return HttpResponse.json([{ id: "le-1", name: "Acme", type: "COMPANY" }]);
      }),
    );
    const rows = await harness().listMine(CUST);
    expect(auth).toBe("Bearer cust-tok");
    expect(rows[0]?.id).toBe("le-1");
  });

  it("get fetches a single legal entity by id", async () => {
    server.use(
      http.get("https://api.emporix.io/customer-management/acme/legal-entities/le-1", () =>
        HttpResponse.json({ id: "le-1", name: "Acme", type: "COMPANY" }),
      ),
    );
    const le = await harness().get("le-1", CUST);
    expect(le.name).toBe("Acme");
  });

  it("create POSTs the body and returns the id", async () => {
    let body: unknown = null;
    server.use(
      http.post("https://api.emporix.io/customer-management/acme/legal-entities", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "le-new" }, { status: 201 });
      }),
    );
    const r = await harness().create({ name: "New Co" }, CUST);
    expect(r.id).toBe("le-new");
    expect(body).toEqual({ name: "New Co" });
  });

  it("update PATCHes the body and returns the entity", async () => {
    server.use(
      http.patch("https://api.emporix.io/customer-management/acme/legal-entities/le-1", () =>
        HttpResponse.json({ id: "le-1", name: "Patched", type: "COMPANY" }),
      ),
    );
    const r = await harness().update("le-1", { name: "Patched" }, CUST);
    expect(r.name).toBe("Patched");
  });

  it("delete DELETEs and returns void", async () => {
    server.use(
      http.delete("https://api.emporix.io/customer-management/acme/legal-entities/le-1", () =>
        new HttpResponse(null, { status: 204 }),
      ),
    );
    await expect(harness().delete("le-1", CUST)).resolves.toBeUndefined();
  });

  it("create surfaces InsufficientScopeError on 403 with scope-hint body", async () => {
    server.use(
      http.post("https://api.emporix.io/customer-management/acme/legal-entities", () =>
        HttpResponse.json(
          { code: 403, status: "Forbidden", details: ["missing scope: customermanagement.legalentity_manage"] },
          { status: 403 },
        ),
      ),
    );
    await expect(harness().create({ name: "x" }, CUST)).rejects.toBeInstanceOf(
      EmporixInsufficientScopeError,
    );
  });

  it("create falls back to plain ForbiddenError on 403 without a scope hint", async () => {
    server.use(
      http.post("https://api.emporix.io/customer-management/acme/legal-entities", () =>
        HttpResponse.json({ code: 403, status: "Forbidden" }, { status: 403 }),
      ),
    );
    await expect(harness().create({ name: "x" }, CUST)).rejects.toBeInstanceOf(
      EmporixForbiddenError,
    );
  });
});
