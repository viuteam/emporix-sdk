import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { CartService } from "../../src/services/cart";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";
import { EmporixValidationError } from "../../src/core/errors";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
  http.post("https://api.emporix.io/cart/acme/carts", ({ request }) => {
    expect(request.headers.get("authorization")).toBe("Bearer anon");
    return HttpResponse.json({ id: "cart1", items: [] });
  }),
  http.post("https://api.emporix.io/cart/acme/carts/cart1/merge", ({ request }) => {
    expect(request.headers.get("authorization")).toBe("Bearer CUST");
    return HttpResponse.json({ id: "cart-merged", items: [{ id: "i1" }] });
  }),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function svc() {
  const cfg = {
    tenant: "acme", host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "cart" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io", provider: tokenProvider, logger,
    retry: { maxAttempts: 1 }, timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new CartService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

describe("CartService", () => {
  it("refuses calls without an explicit customer/anonymous context", async () => {
    // @ts-expect-error auth is required
    await expect(svc().create()).rejects.toBeInstanceOf(EmporixValidationError);
    await expect(
      svc().create({ currency: "EUR" }, { kind: "service" } as never),
    ).rejects.toBeInstanceOf(EmporixValidationError);
  });

  it("create() works with an anonymous context", async () => {
    const c = await svc().create({ currency: "EUR" }, { kind: "anonymous" });
    expect(c.id).toBe("cart1");
  });

  it("merge() requires a customer context and returns the merged cart", async () => {
    await expect(
      svc().merge("cart1", { kind: "anonymous" }),
    ).rejects.toBeInstanceOf(EmporixValidationError);
    const merged = await svc().merge("cart1", { kind: "customer", token: "CUST" });
    expect(merged.id).toBe("cart-merged");
  });
});
