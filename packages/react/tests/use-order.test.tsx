import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useOrder } from "../src/hooks/use-order";
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

function wrap(storage = createMemoryStorage({ initial: "cust" })) {
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

describe("useOrder", () => {
  it("is disabled when orderId is undefined", () => {
    const { result } = renderHook(() => useOrder(undefined), { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("fetches a single order", async () => {
    server.use(
      http.get("https://api.emporix.io/order-v2/acme/orders/o-1", () =>
        HttpResponse.json({
          id: "o-1",
          status: "CREATED",
          currency: "CHF",
          totalPrice: 10,
          entries: [],
          customer: { id: "c1", email: "a@b.co" },
          mixins: { generalAttributes: { orderNumber: "ORD-1" } },
        }),
      ),
    );
    const { result } = renderHook(() => useOrder("o-1"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe("o-1");
    expect(result.current.data?.status).toBe("CREATED");
  });
});
