import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useCart } from "../src/hooks/queries";
import { useCartMutations } from "../src/hooks/use-cart-mutations";
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

function wrap() {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    logger: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={createMemoryStorage()} queryClient={queryClient}>
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
