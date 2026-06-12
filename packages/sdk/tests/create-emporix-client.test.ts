import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { createEmporixClient } from "../src/create-emporix-client";
import { ProductService } from "../src/services/product";
import { CategoryService } from "../src/services/category";
import { SegmentService } from "../src/services/segment";
import { EmporixError } from "../src/core/errors";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({ access_token: "anon", token_type: "Bearer", expires_in: 3599, refresh_token: "rt", sessionId: "s" }),
  ),
  http.get("https://api.emporix.io/product/acme/products/p1", () => HttpResponse.json({ id: "p1", name: "Widget" })),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const config = { tenant: "acme", credentials: { storefront: { clientId: "sf" } }, logger: false as const };

describe("createEmporixClient", () => {
  it("builds only the requested services and they work like EmporixClient's", async () => {
    const client = createEmporixClient(config, { products: ProductService });
    expect(client.tenant).toBe("acme");
    const p = await client.products.get("p1", undefined, { kind: "anonymous" });
    expect((p as { name?: string }).name).toBe("Widget");
    // unrequested services are absent
    expect((client as Record<string, unknown>).carts).toBeUndefined();
  });

  it("wires SegmentService's product/category deps", () => {
    const client = createEmporixClient(config, {
      products: ProductService, categories: CategoryService, segments: SegmentService,
    });
    expect(client.segments).toBeInstanceOf(SegmentService);
    expect(client.products).toBeInstanceOf(ProductService);
  });

  it("throws when a dependent service is missing its deps", () => {
    expect(() => createEmporixClient(config, { segments: SegmentService })).toThrow(EmporixError);
    expect(() => createEmporixClient(config, { segments: SegmentService })).toThrow(/requires "products"/);
  });

  it("exposes the core public surface", () => {
    const client = createEmporixClient(config, { products: ProductService });
    expect(typeof client.setStorefrontContext).toBe("function");
    expect(client.tokenProvider).toBeDefined();
  });
});
