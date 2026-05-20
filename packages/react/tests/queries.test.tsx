import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import {
  useProduct,
  useProducts,
  useProductsInfinite,
  useCategory,
  useCategories,
  useCategoriesInfinite,
  useCart,
} from "../src/hooks/queries";
import type { ReactNode } from "react";

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
  http.get("https://api.emporix.io/category/acme/categories/c1", () =>
    HttpResponse.json({ id: "c1", name: "Books" }),
  ),
  http.get("https://api.emporix.io/cart/acme/carts/cart1", () =>
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
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
}

describe("query hooks", () => {
  it("useProduct fetches anonymously by default", async () => {
    const { result } = renderHook(() => useProduct("p1"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.data?.name).toBe("Widget"));
  });

  it("useCategory fetches a category", async () => {
    const { result } = renderHook(() => useCategory("c1"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.data?.name).toBe("Books"));
  });

  it("useCart is disabled without a cartId", () => {
    const { result } = renderHook(() => useCart(undefined), { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("useCart uses customer auth when a token is stored", async () => {
    const storage = createMemoryStorage({ initial: "cust-tok" });
    const { result } = renderHook(() => useCart("cart1"), { wrapper: wrap(storage) });
    await waitFor(() => expect(result.current.data?.id).toBe("cart1"));
  });

  it("useProducts returns PaginatedItems<Product>", async () => {
    server.use(
      http.get("https://api.emporix.io/product/acme/products", () =>
        HttpResponse.json([{ id: "p1" }, { id: "p2" }]),
      ),
    );
    const { result } = renderHook(() => useProducts({ pageNumber: 1, pageSize: 2 }), {
      wrapper: wrap(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      items: [{ id: "p1" }, { id: "p2" }],
      pageNumber: 1,
      pageSize: 2,
      hasNextPage: true,
    });
  });

  it("useCategories returns PaginatedItems<Category>", async () => {
    server.use(
      http.get("https://api.emporix.io/category/acme/categories", () =>
        HttpResponse.json([{ id: "c1" }]),
      ),
    );
    const { result } = renderHook(() => useCategories({ pageNumber: 1, pageSize: 50 }), {
      wrapper: wrap(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items).toEqual([{ id: "c1" }]);
    expect(result.current.data?.hasNextPage).toBe(false);
  });

  it("useProductsInfinite terminates on hasNextPage=false without a trailing empty fetch", async () => {
    let calls = 0;
    server.use(
      http.get("https://api.emporix.io/product/acme/products", ({ request }) => {
        calls += 1;
        const u = new URL(request.url);
        const page = Number(u.searchParams.get("pageNumber") ?? "1");
        return page === 1
          ? HttpResponse.json([{ id: "p1" }, { id: "p2" }])
          : HttpResponse.json([{ id: "p3" }]);
      }),
    );
    const { result } = renderHook(() => useProductsInfinite({ pageSize: 2 }), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    expect(calls).toBe(2);
    expect(
      result.current.data?.pages.flatMap((p) => p.items).map((p) => p.id),
    ).toEqual(["p1", "p2", "p3"]);
  });

  it("useCategoriesInfinite fetches across pages and terminates on hasNextPage=false", async () => {
    let calls = 0;
    server.use(
      http.get("https://api.emporix.io/category/acme/categories", ({ request }) => {
        calls += 1;
        const u = new URL(request.url);
        const page = Number(u.searchParams.get("pageNumber") ?? "1");
        return page === 1
          ? HttpResponse.json([{ id: "c1" }, { id: "c2" }])
          : HttpResponse.json([{ id: "c3" }]);
      }),
    );
    const { result } = renderHook(() => useCategoriesInfinite({ pageSize: 2 }), {
      wrapper: wrap(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    expect(calls).toBe(2);
    expect(
      result.current.data?.pages.flatMap((p) => p.items).map((c) => c.id),
    ).toEqual(["c1", "c2", "c3"]);
  });
});
