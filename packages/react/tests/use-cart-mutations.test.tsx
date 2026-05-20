import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useCart } from "../src/hooks/queries";
import { useCartMutations, useCreateCart } from "../src/hooks/use-cart-mutations";
import type { EmporixStorage } from "../src/storage";
import type { ReactNode } from "react";

let addShouldFail = false;
const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
  http.get("https://api.emporix.io/cart/acme/carts/cart1", () =>
    HttpResponse.json({ id: "cart1", items: [] }),
  ),
  http.post("https://api.emporix.io/cart/acme/carts/cart1/items", () =>
    addShouldFail
      ? HttpResponse.json({ message: "no" }, { status: 422 })
      : HttpResponse.json({ id: "cart1", items: [{ id: "i1", productId: "p1" }] }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  addShouldFail = false;
});
afterAll(() => server.close());

function wrap(storage: EmporixStorage = createMemoryStorage()) {
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

describe("useCartMutations", () => {
  it("addItem updates the cart cache", async () => {
    const wrapper = wrap();
    const { result } = renderHook(
      () => ({ cart: useCart("cart1"), mut: useCartMutations("cart1") }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.cart.data?.id).toBe("cart1"));
    await act(async () => {
      await result.current.mut.addItem.mutateAsync({ product: { id: "p1" }, quantity: 1, price: { priceId: "pr1", originalAmount: 10, effectiveAmount: 10, currency: "EUR" } });
    });
    await waitFor(() => expect(result.current.cart.data?.items).toHaveLength(1));
  });

  it("rolls back the optimistic update on error", async () => {
    addShouldFail = true;
    const wrapper = wrap();
    const { result } = renderHook(
      () => ({ cart: useCart("cart1"), mut: useCartMutations("cart1") }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.cart.data?.items).toHaveLength(0));
    await act(async () => {
      await result.current.mut.addItem
        .mutateAsync({ product: { id: "p1" }, quantity: 1, price: { priceId: "pr1", originalAmount: 10, effectiveAmount: 10, currency: "EUR" } })
        .catch(() => undefined);
    });
    await waitFor(() => expect(result.current.cart.data?.items).toHaveLength(0));
  });

  it("optimistic add falls back when the product has no id", async () => {
    const wrapper = wrap();
    const { result } = renderHook(
      () => ({ cart: useCart("cart1"), mut: useCartMutations("cart1") }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.cart.data?.id).toBe("cart1"));
    await act(async () => {
      await result.current.mut.addItem.mutateAsync({
        product: {},
        quantity: 1,
        price: { priceId: "pr1", originalAmount: 10, effectiveAmount: 10, currency: "EUR" },
      });
    });
    await waitFor(() => expect(result.current.cart.data?.items).toHaveLength(1));
  });
});

describe("useCreateCart", () => {
  it("creates an anonymous cart and persists cartId in storage", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.post("https://api.emporix.io/cart/acme/carts", ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json(
          { cartId: "cart-new", yrn: "yrn:cart:cart-new" },
          { status: 201 },
        );
      }),
    );
    const storage = createMemoryStorage();
    const wrapper = wrap(storage);
    const { result } = renderHook(() => useCreateCart(), { wrapper });

    let returned: { cartId?: string } | undefined;
    await act(async () => {
      returned = await result.current.mutateAsync({ currency: "CHF" });
    });

    expect(returned?.cartId).toBe("cart-new");
    expect(storage.getCartId()).toBe("cart-new");
    expect(seenAuth).toBe("Bearer anon");
  });

  it("uses the customer token when one is stored", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.post("https://api.emporix.io/cart/acme/carts", ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json(
          { cartId: "cart-c", yrn: "yrn:cart:cart-c" },
          { status: 201 },
        );
      }),
    );
    const storage = createMemoryStorage({ initial: "CUST-TOK" });
    const wrapper = wrap(storage);
    const { result } = renderHook(() => useCreateCart(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ currency: "CHF" });
    });
    expect(seenAuth).toBe("Bearer CUST-TOK");
    expect(storage.getCartId()).toBe("cart-c");
  });
});
