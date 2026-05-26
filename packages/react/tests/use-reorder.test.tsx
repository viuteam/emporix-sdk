import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useReorder } from "../src/hooks/use-reorder";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({ access_token: "anon", token_type: "Bearer", expires_in: 3599, refresh_token: "r", sessionId: "s" }),
  ),
  http.get("https://api.emporix.io/customer-management/acme/legal-entities", () => HttpResponse.json([])),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap() {
  const storage = createMemoryStorage({ initial: "cust" });
  storage.setCartId("cart-1");
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={new QueryClient()}>
      {children}
    </EmporixProvider>
  );
}

describe("useReorder", () => {
  it("fetches order, adds each item to cart, returns { added }", async () => {
    const added: unknown[] = [];
    server.use(
      http.get("https://api.emporix.io/order-v2/acme/orders/o-1", () =>
        HttpResponse.json({
          id: "o-1", orderNumber: "ORD-1", status: "COMPLETED", currency: "CHF",
          totalPrice: { amount: 30, currency: "CHF" },
          items: [
            { id: "i1", productId: "p-1", quantity: 2, unitPrice: { amount: 10, currency: "CHF" }, totalPrice: { amount: 20, currency: "CHF" } },
            { id: "i2", productId: "p-2", quantity: 1, unitPrice: { amount: 10, currency: "CHF" }, totalPrice: { amount: 10, currency: "CHF" } },
          ],
        }),
      ),
      http.post("https://api.emporix.io/cart/acme/carts/cart-1/items", async ({ request }) => {
        added.push(await request.json());
        return HttpResponse.json({ id: "cart-1", items: [] });
      }),
    );
    const { result } = renderHook(() => useReorder(), { wrapper: wrap() });
    let res: { added: number; errors: unknown[] } | undefined;
    await act(async () => {
      res = await result.current.mutateAsync({ orderId: "o-1" });
    });
    expect(res?.added).toBe(2);
    expect(res?.errors).toEqual([]);
    expect(added).toHaveLength(2);
    expect(added[0]).toMatchObject({ product: { id: "p-1" }, quantity: 2 });
    expect(added[1]).toMatchObject({ product: { id: "p-2" }, quantity: 1 });
  });

  it("collects errors but does not throw on item-level failures", async () => {
    server.use(
      http.get("https://api.emporix.io/order-v2/acme/orders/o-1", () =>
        HttpResponse.json({
          id: "o-1", orderNumber: "ORD-1", status: "COMPLETED", currency: "CHF",
          totalPrice: { amount: 20, currency: "CHF" },
          items: [
            { id: "i1", productId: "p-ok", quantity: 1, unitPrice: { amount: 10, currency: "CHF" }, totalPrice: { amount: 10, currency: "CHF" } },
            { id: "i2", productId: "p-gone", quantity: 1, unitPrice: { amount: 10, currency: "CHF" }, totalPrice: { amount: 10, currency: "CHF" } },
          ],
        }),
      ),
      http.post("https://api.emporix.io/cart/acme/carts/cart-1/items", async ({ request }) => {
        const body = (await request.json()) as { product?: { id?: string } };
        if (body.product?.id === "p-gone") return HttpResponse.json({ message: "discontinued" }, { status: 404 });
        return HttpResponse.json({ id: "cart-1", items: [] });
      }),
    );
    const { result } = renderHook(() => useReorder(), { wrapper: wrap() });
    let res: { added: number; errors: unknown[] } | undefined;
    await act(async () => {
      res = await result.current.mutateAsync({ orderId: "o-1" });
    });
    expect(res?.added).toBe(1);
    expect(res?.errors).toHaveLength(1);
  });
});
