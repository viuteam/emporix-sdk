import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { CustomerGroupsService } from "../../src/services/customer-groups";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";

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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "iam" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new CustomerGroupsService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const CUST = { kind: "customer" as const, token: "cust-tok" };

describe("CustomerGroupsService", () => {
  it("listForCompany sends b2b.legalEntityId as query param", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.get("https://api.emporix.io/iam/acme/groups", ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json([
          { id: "grp-admin", name: { en: "Admin" }, code: "ADMIN", b2b: { legalEntityId: "le-1" } },
          { id: "grp-buyer", name: { en: "Buyer" }, code: "BUYER", b2b: { legalEntityId: "le-1" } },
        ]);
      }),
    );
    const rows = await harness().listForCompany("le-1", CUST);
    expect((q as URLSearchParams | null)?.get("b2b.legalEntityId")).toBe("le-1");
    expect(rows.map((r) => r.code)).toEqual(["ADMIN", "BUYER"]);
  });

  it("addMember POSTs the assignment body and returns the new id", async () => {
    let body: unknown = null;
    server.use(
      http.post(
        "https://api.emporix.io/iam/acme/groups/grp-admin/users",
        async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ id: "assign-1" }, { status: 201 });
        },
      ),
    );
    const r = await harness().addMember(
      "grp-admin",
      { userId: "cust-9", userType: "CUSTOMER" },
      CUST,
    );
    expect(r.id).toBe("assign-1");
    expect(body).toEqual({ userId: "cust-9", userType: "CUSTOMER" });
  });

  it("removeMember DELETEs the user and returns void", async () => {
    server.use(
      http.delete(
        "https://api.emporix.io/iam/acme/groups/grp-admin/users/cust-9",
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    await expect(harness().removeMember("grp-admin", "cust-9", CUST)).resolves.toBeUndefined();
  });
});
