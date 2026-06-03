import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, dehydrate } from "@tanstack/react-query";
import { EmporixClient, EmporixAuthError, EmporixError, auth } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import {
  useProducts,
  useProductsInfinite,
  useCategories,
  useCategoryTree,
  useCustomerSession,
  useCartMutations,
} from "../src/hooks/index";
import { useEmporixErrorHandler } from "../src/errors";
import { prefetchCart } from "../src/ssr";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
  http.get("https://api.emporix.io/product/acme/products", () =>
    HttpResponse.json([{ id: "p1" }]),
  ),
  http.get("https://api.emporix.io/category/acme/categories", () =>
    HttpResponse.json([{ id: "c1" }]),
  ),
  http.get("https://api.emporix.io/category/acme/category-trees", () =>
    HttpResponse.json([{ id: "root", name: "Root" }]),
  ),
  http.post("https://api.emporix.io/customer/acme/signup", () =>
    HttpResponse.json({ id: "c1", contactEmail: "a@b.co" }),
  ),
  http.get("https://api.emporix.io/customer/acme/me", () =>
    HttpResponse.json({ id: "c1", contactEmail: "a@b.co" }),
  ),
  http.get("https://api.emporix.io/cart/acme/carts/cart1", () =>
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
  http.delete("https://api.emporix.io/cart/acme/carts/cart1/coupons/CC", () =>
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

function wrap(storage = createMemoryStorage()) {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    logger: false,
  });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider
      client={client}
      storage={storage}
      queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {children}
    </EmporixProvider>
  );
}

describe("remaining query hooks", () => {
  it("useProducts / useProductsInfinite / useCategories / useCategoryTree resolve", async () => {
    const { result } = renderHook(
      () => ({
        p: useProducts({ pageSize: 1 }),
        pi: useProductsInfinite({ pageSize: 1 }),
        c: useCategories(),
        t: useCategoryTree(),
      }),
      { wrapper: wrap() },
    );
    await waitFor(() => expect(result.current.p.data?.items).toHaveLength(1));
    await waitFor(() => expect(result.current.pi.data?.pages[0]?.items).toHaveLength(1));
    await waitFor(() => expect(result.current.c.data?.items).toHaveLength(1));
    await waitFor(() => expect(result.current.t.data?.[0]?.id).toBe("root"));
  });

  it("query hooks accept an explicit auth override", async () => {
    const { result } = renderHook(() => useProducts({}, { auth: auth.anonymous() }), {
      wrapper: wrap(),
    });
    await waitFor(() => expect(result.current.data?.items).toBeDefined());
  });
});

describe("useCustomerSession signup + refresh", () => {
  it("signup calls the API; refresh refetches me", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    const { result } = renderHook(() => useCustomerSession(), { wrapper: wrap(storage) });
    await act(async () => {
      await result.current.signup({ email: "a@b.co", password: "p" });
    });
    await waitFor(() => expect(result.current.customer?.id).toBe("c1"));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.customer?.contactEmail).toBe("a@b.co");
  });
});

describe("useCartMutations remaining methods", () => {
  it("update/remove/clear/coupons/addresses mutate", async () => {
    const { result } = renderHook(() => useCartMutations("cart1"), { wrapper: wrap() });
    await act(async () => {
      await result.current.updateItem.mutateAsync({ itemId: "i1", patch: { quantity: 3 } });
      await result.current.removeItem.mutateAsync({ itemId: "i1" });
      await result.current.clear.mutateAsync();
      await result.current.applyCoupon.mutateAsync({ code: "CC" });
      await result.current.removeCoupon.mutateAsync({ code: "CC" });
      await result.current.setShippingAddress.mutateAsync({ city: "Berlin" });
      await result.current.setBillingAddress.mutateAsync({ city: "Berlin" });
    });
    expect(result.current.clear.isSuccess).toBe(true);
  });
});

describe("useEmporixErrorHandler", () => {
  it("routes auth vs generic errors", () => {
    let authHit = 0;
    let genHit = 0;
    const { result } = renderHook(() =>
      useEmporixErrorHandler({
        onAuthError: () => (authHit += 1),
        onError: () => (genHit += 1),
      }),
    );
    result.current(new EmporixAuthError("x", 401, {}));
    result.current(new EmporixError("y", 500, {}));
    result.current(new Error("ignored"));
    expect(authHit).toBe(1);
    expect(genHit).toBe(1);
  });
});

describe("ssr prefetchCart", () => {
  it("prefetches a cart into a QueryClient", async () => {
    const client = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    const qc = new QueryClient();
    await prefetchCart(qc, client, "cart1", auth.anonymous());
    expect(JSON.stringify(dehydrate(qc))).toContain("cart1");
  });
});
