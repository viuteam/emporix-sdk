import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { auth, EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useUpdateSalesOrder } from "../src/hooks/use-update-sales-order";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({ access_token: "anon", token_type: "Bearer", expires_in: 3599, refresh_token: "r", sessionId: "s" }),
  ),
  http.get("https://api.emporix.io/customer-management/acme/legal-entities", () => HttpResponse.json([])),
  http.post("https://api.emporix.io/oauth/token", () =>
    HttpResponse.json({ access_token: "svc-tok", expires_in: 3600 }),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap() {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: {
      backend: { clientId: "b", secret: "s" },
      storefront: { clientId: "sf" },
    },
    logger: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={createMemoryStorage()} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
}

describe("useUpdateSalesOrder", () => {
  it("PATCHes the order and returns the updated body", async () => {
    server.use(
      http.patch("https://api.emporix.io/order-v2/acme/salesorders/o-1", () =>
        HttpResponse.json({
          id: "o-1", orderNumber: "ORD-1", status: "SHIPPED",
          currency: "CHF", totalPrice: { amount: 50, currency: "CHF" }, items: [],
        }),
      ),
    );
    const { result } = renderHook(() => useUpdateSalesOrder(), { wrapper: wrap() });
    let r: unknown;
    await act(async () => {
      r = await result.current.mutateAsync({
        orderId: "o-1",
        patch: { status: "SHIPPED" },
        auth: auth.service(),
      });
    });
    expect((r as { status?: string }).status).toBe("SHIPPED");
  });

  it("throws synchronously when auth is missing", async () => {
    const { result } = renderHook(() => useUpdateSalesOrder(), { wrapper: wrap() });
    await expect(
      result.current.mutateAsync({
        orderId: "o-1",
        patch: { status: "SHIPPED" },
        auth: undefined as unknown as ReturnType<typeof auth.service>,
      }),
    ).rejects.toThrow(/requires.*auth/i);
  });
});
