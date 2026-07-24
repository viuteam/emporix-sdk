import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { ContactsService } from "../../src/services/contacts";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "customer-management" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new ContactsService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const CUST = { kind: "customer" as const, token: "cust-tok" };

describe("ContactsService", () => {
  it("listForCompany GETs with legalEntityId query param", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.get("https://api.emporix.io/customer-management/acme/contact-assignments", ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json([{ id: "ca-1", type: "CONTACT" }]);
      }),
    );
    const rows = await harness().listForCompany("le-1", CUST);
    expect((q as URLSearchParams | null)?.get("legalEntityId")).toBe("le-1");
    expect(rows[0]?.id).toBe("ca-1");
  });

  it("assign POSTs legalEntity + customer + type", async () => {
    let body: unknown = null;
    server.use(
      http.post("https://api.emporix.io/customer-management/acme/contact-assignments", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "ca-new" }, { status: 201 });
      }),
    );
    const r = await harness().assign(
      { legalEntity: { id: "le-1" }, customer: { id: "cu-1" }, type: "BILLING", primary: true },
      CUST,
    );
    expect(r.id).toBe("ca-new");
    expect(body).toEqual({
      legalEntity: { id: "le-1" },
      customer: { id: "cu-1" },
      type: "BILLING",
      primary: true,
    });
  });

  it("update PUTs the assignment", async () => {
    server.use(
      http.put("https://api.emporix.io/customer-management/acme/contact-assignments/ca-1", () =>
        HttpResponse.json({ id: "ca-1", type: "LOGISTICS" }),
      ),
    );
    const r = await harness().update("ca-1", { type: "LOGISTICS" }, CUST);
    expect(r.type).toBe("LOGISTICS");
  });

  it("unassign DELETEs and returns void", async () => {
    server.use(
      http.delete("https://api.emporix.io/customer-management/acme/contact-assignments/ca-1", () =>
        new HttpResponse(null, { status: 204 }),
      ),
    );
    await expect(harness().unassign("ca-1", CUST)).resolves.toBeUndefined();
  });
});
