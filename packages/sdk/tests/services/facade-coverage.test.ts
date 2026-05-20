import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { CustomerService } from "../../src/services/customer";
import { ProductService } from "../../src/services/product";
import { CategoryService } from "../../src/services/category";
import { CartService } from "../../src/services/cart";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";
import type { ClientContext } from "../../src/core/context";

const CUST = { kind: "customer", token: "C" } as const;
const ANON = { kind: "anonymous" } as const;

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
  // customer
  http.post("https://api.emporix.io/customer/acme/signup", () =>
    HttpResponse.json({ id: "c1", email: "a@b.co" }),
  ),
  http.put("https://api.emporix.io/customer/acme/me", () =>
    HttpResponse.json({ id: "c1", email: "a@b.co", firstName: "Z" }),
  ),
  http.put("https://api.emporix.io/customer/acme/password", () => new HttpResponse(null, { status: 204 })),
  http.post("https://api.emporix.io/customer/acme/password/reset", () => new HttpResponse(null, { status: 204 })),
  http.post("https://api.emporix.io/customer/acme/password/reset/confirm", () => new HttpResponse(null, { status: 204 })),
  http.post("https://api.emporix.io/customer/acme/me/addresses", () =>
    HttpResponse.json({ id: "ad1", city: "Berlin" }),
  ),
  http.put("https://api.emporix.io/customer/acme/me/addresses/ad1", () =>
    HttpResponse.json({ id: "ad1", city: "Munich" }),
  ),
  http.delete("https://api.emporix.io/customer/acme/me/addresses/ad1", () => new HttpResponse(null, { status: 204 })),
  // product
  http.get("https://api.emporix.io/product/acme/products", ({ request }) => {
    const u = new URL(request.url);
    if (u.searchParams.get("q")?.startsWith("code:")) return HttpResponse.json([{ id: "p9", code: "X" }]);
    if (u.searchParams.get("q") === "widget") return HttpResponse.json([{ id: "p1" }]);
    return HttpResponse.json([{ id: "p1" }, { id: "p2" }]);
  }),
  // category
  http.get("https://api.emporix.io/category/acme/categories", ({ request }) => {
    const page = Number(new URL(request.url).searchParams.get("pageNumber") ?? "1");
    return HttpResponse.json(page === 1 ? [{ id: "c1" }, { id: "c2" }] : []);
  }),
  http.get("https://api.emporix.io/category/acme/categories/c1/products", () =>
    HttpResponse.json([{ id: "p1" }]),
  ),
  // cart
  http.get("https://api.emporix.io/cart/acme/carts/cart1", () =>
    HttpResponse.json({ id: "cart1", items: [] }),
  ),
  http.get("https://api.emporix.io/cart/acme/carts", () =>
    HttpResponse.json([{ id: "cartCur", items: [] }]),
  ),
  http.post("https://api.emporix.io/cart/acme/carts/cart1/items", () =>
    HttpResponse.json({ id: "cart1", items: [{ id: "i1" }] }),
  ),
  http.put("https://api.emporix.io/cart/acme/carts/cart1/items/i1", () =>
    HttpResponse.json({ id: "cart1", items: [{ id: "i1" }] }),
  ),
  http.delete("https://api.emporix.io/cart/acme/carts/cart1/items/i1", () =>
    HttpResponse.json({ id: "cart1", items: [] }),
  ),
  http.delete("https://api.emporix.io/cart/acme/carts/cart1/items", () =>
    HttpResponse.json({ id: "cart1", items: [] }),
  ),
  http.post("https://api.emporix.io/cart/acme/carts/cart1/coupons", () =>
    HttpResponse.json({ id: "cart1", items: [] }),
  ),
  http.delete("https://api.emporix.io/cart/acme/carts/cart1/coupons/C1", () =>
    HttpResponse.json({ id: "cart1", items: [] }),
  ),
  http.put("https://api.emporix.io/cart/acme/carts/cart1/shipping-address", () =>
    HttpResponse.json({ id: "cart1", items: [] }),
  ),
  http.put("https://api.emporix.io/cart/acme/carts/cart1/billing-address", () =>
    HttpResponse.json({ id: "cart1", items: [] }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function ctx(service: string): ClientContext {
  const cfg = {
    tenant: "acme", host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service });
  return {
    tenant: "acme",
    tokenProvider,
    logger,
    http: new HttpClient({
      host: "https://api.emporix.io", provider: tokenProvider, logger,
      retry: { maxAttempts: 1 }, timeouts: { connectMs: 1000, readMs: 1000 },
    }),
  };
}

describe("CustomerService remaining methods", () => {
  const s = () => new CustomerService(ctx("customer"));
  it("signup/update/changePassword/password-reset/addresses", async () => {
    expect((await s().signup({ email: "a@b.co", password: "p" })).id).toBe("c1");
    expect((await s().update({ firstName: "Z" }, CUST)).firstName).toBe("Z");
    await expect(
      s().changePassword({ currentPassword: "o", newPassword: "n" }, CUST),
    ).resolves.toBeUndefined();
    await expect(s().requestPasswordReset({ email: "a@b.co" })).resolves.toBeUndefined();
    await expect(
      s().confirmPasswordReset({ token: "t", password: "n" }),
    ).resolves.toBeUndefined();
    expect(
      (await s().addresses.add({ contactName: "A", city: "Berlin" }, CUST)).id,
    ).toBe("ad1");
    expect((await s().addresses.update("ad1", { city: "Munich" }, CUST)).city).toBe("Munich");
    await expect(s().addresses.remove("ad1", CUST)).resolves.toBeUndefined();
  });
});

describe("ProductService remaining methods", () => {
  const s = () => new ProductService(ctx("product"));
  it("getByCode/list/search", async () => {
    expect((await s().getByCode("X")).id).toBe("p9");
    expect((await s().list({ pageNumber: 1, pageSize: 2 })).items).toHaveLength(2);
    expect((await s().search("widget")).items[0]?.id).toBe("p1");
  });
  it("getByCode throws when missing", async () => {
    server.use(
      http.get("https://api.emporix.io/product/acme/products", () => HttpResponse.json([])),
    );
    await expect(s().getByCode("none")).rejects.toThrow(/no product/i);
  });
});

describe("CategoryService remaining methods", () => {
  const s = () => new CategoryService(ctx("category"));
  it("list/listAll/productsIn", async () => {
    expect((await s().list()).items).toHaveLength(2);
    const ids: string[] = [];
    for await (const c of s().listAll({ pageSize: 2 })) ids.push(c.id);
    expect(ids).toEqual(["c1", "c2"]);
    expect((await s().productsIn("c1")).items[0]?.id).toBe("p1");
  });
});

describe("CartService remaining methods", () => {
  const s = () => new CartService(ctx("cart"));
  it("get/getCurrent/items/coupons/addresses", async () => {
    expect((await s().get("cart1", ANON)).id).toBe("cart1");
    expect((await s().getCurrent(ANON))?.id).toBe("cartCur");
    expect(
      (
        await s().addItem(
          "cart1",
          {
            product: { id: "p1" },
            quantity: 1,
            price: { priceId: "pr1", originalAmount: 10, effectiveAmount: 10, currency: "EUR" },
          },
          ANON,
        )
      ).items,
    ).toHaveLength(1);
    await s().updateItem("cart1", "i1", { quantity: 2 }, ANON);
    await s().removeItem("cart1", "i1", ANON);
    await s().clear("cart1", ANON);
    await s().applyCoupon("cart1", "C1", ANON);
    await s().removeCoupon("cart1", "C1", ANON);
    await s().setShippingAddress("cart1", { city: "Berlin" }, ANON);
    await s().setBillingAddress("cart1", { city: "Berlin" }, ANON);
  });
});
