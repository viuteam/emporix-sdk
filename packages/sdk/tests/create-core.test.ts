import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { createCore } from "../src/core/create-core";
import { ProductService } from "../src/services/product";

const server = setupServer(
  http.post("https://api.emporix.io/oauth/token", () =>
    HttpResponse.json({ access_token: "svc", token_type: "Bearer", expires_in: 3600 }),
  ),
  http.get("https://api.emporix.io/product/acme/products/p1", () =>
    HttpResponse.json({ id: "p1", name: "Widget" }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("createCore", () => {
  it("builds a working ClientContext via mk() that a service can use", async () => {
    const core = createCore({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(core.tenant).toBe("acme");
    const products = new ProductService(core.mk(ProductService.channel));
    const p = await products.get("p1", undefined, { kind: "service" });
    expect((p as { name?: string }).name).toBe("Widget");
  });

  it("exposes the non-service public surface", () => {
    const core = createCore({ tenant: "acme", credentials: { storefront: { clientId: "sf" } }, logger: false });
    expect(typeof core.setStorefrontContext).toBe("function");
    expect(typeof core.setLogLevel).toBe("function");
    expect(typeof core.getLogLevel).toBe("function");
    expect(typeof core.setCustomerTokenRefresher).toBe("function");
    expect(core.tokenProvider).toBeDefined();
  });
});
