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
          { id: "grp-admin", name: { en: "Admin" }, role: "ADMIN", b2b: { legalEntityId: "le-1" } },
          { id: "grp-buyer", name: { en: "Buyer" }, role: "BUYER", b2b: { legalEntityId: "le-1" } },
        ]);
      }),
    );
    const rows = await harness().listForCompany("le-1", CUST);
    expect((q as URLSearchParams | null)?.get("b2b.legalEntityId")).toBe("le-1");
    expect(rows.map((r) => r.role)).toEqual(["ADMIN", "BUYER"]);
  });
});
