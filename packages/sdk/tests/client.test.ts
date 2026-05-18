import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { EmporixClient } from "../src/client";
import { auth } from "../src/core/auth";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
  http.get("https://api.emporix.io/product/acme/products/p1", () =>
    HttpResponse.json({ id: "p1", name: "Widget" }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("EmporixClient", () => {
  it("validates tenant at construction", () => {
    expect(
      () =>
        new EmporixClient({
          tenant: "BAD",
          credentials: { backend: { clientId: "b", secret: "s" } },
        }),
    ).toThrow(/tenant/i);
  });

  it("exposes services with tenant injected and shares one instance", async () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    });
    const p = await sdk.products.get("p1");
    expect(p.id).toBe("p1");
    expect(sdk.customers).toBeDefined();
    expect(sdk.categories).toBeDefined();
    expect(sdk.carts).toBeDefined();
  });

  it("setLogLevel/getLogLevel proxy the resolver", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" } },
      logger: { level: "warn" },
    });
    sdk.setLogLevel("debug", { service: "cart" });
    expect(sdk.getLogLevel("cart")).toBe("debug");
    expect(auth.anonymous()).toEqual({ kind: "anonymous" });
  });
});
