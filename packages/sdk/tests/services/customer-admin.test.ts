import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { CustomerAdminService } from "../../src/services/customer-admin";
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
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "customer-admin" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new CustomerAdminService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/customer/acme/customers";

describe("CustomerAdminService", () => {
  it("listCustomers GETs with a service token", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(BASE, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json([{ customerNumber: "C1" }]);
      }),
    );
    await svc().listCustomers();
    expect(seenAuth).toBe("Bearer svc-tok");
  });

  it("search / get / create / upsert / patch / delete", async () => {
    let searchBody: unknown = null;
    let createBody: unknown = null;
    server.use(
      http.post(`${BASE}/search`, async ({ request }) => {
        searchBody = await request.json();
        return HttpResponse.json([{ customerNumber: "C1" }]);
      }),
      http.get(`${BASE}/C1`, () => HttpResponse.json({ customerNumber: "C1" })),
      http.post(BASE, async ({ request }) => {
        createBody = await request.json();
        return HttpResponse.json({ id: "C1" }, { status: 201 });
      }),
      http.put(`${BASE}/C1`, () => HttpResponse.json({ id: "C1" }, { status: 201 })),
      http.patch(`${BASE}/C1`, () => new HttpResponse(null, { status: 200 })),
      http.delete(`${BASE}/C1`, () => new HttpResponse(null, { status: 204 })),
    );
    await svc().searchCustomers({ email: "a@b.c" });
    expect(searchBody).toEqual({ email: "a@b.c" });
    expect((await svc().getCustomer("C1")) as { customerNumber?: string }).toEqual({ customerNumber: "C1" });
    expect(((await svc().createCustomer({ email: "a@b.c" } as never)) as { id?: string }).id).toBe("C1");
    expect(createBody).toEqual({ email: "a@b.c" });
    await expect(svc().upsertCustomer("C1", { email: "a@b.c" } as never)).resolves.toBeDefined();
    await expect(svc().patchCustomer("C1", { firstName: "A" } as never)).resolves.toBeUndefined();
    await expect(svc().deleteCustomer("C1")).resolves.toBeUndefined();
  });

  it("getCustomer throws EmporixNotFoundError on 404", async () => {
    server.use(http.get(`${BASE}/NOPE`, () => HttpResponse.json({ status: 404, message: "x" }, { status: 404 })));
    await expect(svc().getCustomer("NOPE")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("addresses: list / get / add / upsert / patch / delete", async () => {
    let addBody: unknown = null;
    server.use(
      http.get(`${BASE}/C1/addresses`, () => HttpResponse.json([{ id: "a1" }])),
      http.get(`${BASE}/C1/addresses/a1`, () => HttpResponse.json({ id: "a1" })),
      http.post(`${BASE}/C1/addresses`, async ({ request }) => {
        addBody = await request.json();
        return HttpResponse.json({ id: "a1" }, { status: 201 });
      }),
      http.put(`${BASE}/C1/addresses/a1`, () => HttpResponse.json({ id: "a1" }, { status: 201 })),
      http.patch(`${BASE}/C1/addresses/a1`, () => new HttpResponse(null, { status: 200 })),
      http.delete(`${BASE}/C1/addresses/a1`, () => new HttpResponse(null, { status: 204 })),
    );
    await svc().listAddresses("C1");
    expect((await svc().getAddress("C1", "a1")) as { id?: string }).toEqual({ id: "a1" });
    await svc().addAddress("C1", { street: "Main" } as never);
    expect(addBody).toEqual({ street: "Main" });
    await expect(svc().upsertAddress("C1", "a1", { street: "Main" } as never)).resolves.toBeDefined();
    await expect(svc().patchAddress("C1", "a1", { street: "2nd" } as never)).resolves.toBeUndefined();
    await expect(svc().deleteAddress("C1", "a1")).resolves.toBeUndefined();
  });

  it("address tags via the ?tags= query param", async () => {
    let addSearch = "";
    let delSearch = "";
    server.use(
      http.post(`${BASE}/C1/addresses/a1/tags`, ({ request }) => {
        addSearch = new URL(request.url).search;
        return new HttpResponse(null, { status: 204 });
      }),
      http.delete(`${BASE}/C1/addresses/a1/tags`, ({ request }) => {
        delSearch = new URL(request.url).search;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await svc().addAddressTags("C1", "a1", ["home", "default"]);
    await svc().removeAddressTags("C1", "a1", ["home"]);
    expect(addSearch).toContain("tags=home");
    expect(delSearch).toContain("tags=home");
  });

  it("encodeURIComponent-escapes the customer number", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/customer/acme/customers/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({});
      }),
    );
    await svc().getCustomer("a/b");
    expect(pathname).toBe("/customer/acme/customers/a%2Fb");
  });
});
