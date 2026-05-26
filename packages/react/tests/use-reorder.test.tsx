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
  it("makes ONE batch call and returns { added }", async () => {
    let batchHits = 0;
    let batchBody: unknown = null;
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
      http.post("https://api.emporix.io/cart/acme/carts/cart-1/itemsBatch", async ({ request }) => {
        batchHits += 1;
        batchBody = await request.json();
        return HttpResponse.json([
          { index: 0, status: 201, id: "ci-a" },
          { index: 1, status: 201, id: "ci-b" },
        ]);
      }),
    );
    const { result } = renderHook(() => useReorder(), { wrapper: wrap() });
    let res: { added: number; errors: unknown[] } | undefined;
    await act(async () => {
      res = await result.current.mutateAsync({ orderId: "o-1" });
    });
    expect(batchHits).toBe(1);
    expect(res?.added).toBe(2);
    expect(res?.errors).toEqual([]);
    expect(Array.isArray(batchBody)).toBe(true);
    expect((batchBody as unknown[]).length).toBe(2);
    expect((batchBody as Array<{ product?: { id?: string }; quantity?: number }>)[0]).toMatchObject({
      product: { id: "p-1" },
      quantity: 2,
    });
  });

  it("collects partial failures from the batch response", async () => {
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
      http.post("https://api.emporix.io/cart/acme/carts/cart-1/itemsBatch", () =>
        HttpResponse.json([
          { index: 0, status: 201, id: "ci-a" },
          { index: 1, status: 404, errorMessage: "product discontinued" },
        ]),
      ),
    );
    const { result } = renderHook(() => useReorder(), { wrapper: wrap() });
    let res: { added: number; errors: unknown[] } | undefined;
    await act(async () => {
      res = await result.current.mutateAsync({ orderId: "o-1" });
    });
    expect(res?.added).toBe(1);
    expect(res?.errors).toHaveLength(1);
    expect((res?.errors[0] as Error).message).toMatch(/status=404/);
    expect((res?.errors[0] as Error).message).toMatch(/discontinued/);
  });

  it("short-circuits on empty order (no batch call)", async () => {
    let batchHits = 0;
    server.use(
      http.get("https://api.emporix.io/order-v2/acme/orders/o-empty", () =>
        HttpResponse.json({
          id: "o-empty", orderNumber: "ORD-E", status: "COMPLETED", currency: "CHF",
          totalPrice: { amount: 0, currency: "CHF" }, items: [],
        }),
      ),
      http.post("https://api.emporix.io/cart/acme/carts/cart-1/itemsBatch", () => {
        batchHits += 1;
        return HttpResponse.json([]);
      }),
    );
    const { result } = renderHook(() => useReorder(), { wrapper: wrap() });
    let res: { added: number; errors: unknown[] } | undefined;
    await act(async () => {
      res = await result.current.mutateAsync({ orderId: "o-empty" });
    });
    expect(batchHits).toBe(0);
    expect(res?.added).toBe(0);
    expect(res?.errors).toEqual([]);
  });
});
