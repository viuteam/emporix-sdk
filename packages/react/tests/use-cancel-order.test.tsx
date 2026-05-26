import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useCancelOrder } from "../src/hooks/use-cancel-order";
import { useMyOrders } from "../src/hooks/use-my-orders";
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
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
  return { Wrapper, queryClient };
}

describe("useCancelOrder", () => {
  it("POSTs DECLINED to /orders/{id}/transitions", async () => {
    const { Wrapper } = wrap();
    let body: unknown = null;
    server.use(
      http.post("https://api.emporix.io/order-v2/acme/orders/o-1/transitions", async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { result } = renderHook(() => useCancelOrder(), { wrapper: Wrapper });
    await act(async () => {
      await result.current.mutateAsync("o-1");
    });
    expect(body).toEqual({ status: "DECLINED" });
  });

  it("invalidates useMyOrders after success", async () => {
    const { Wrapper } = wrap();
    let listCalls = 0;
    server.use(
      http.get("https://api.emporix.io/order-v2/acme/orders", () => {
        listCalls += 1;
        return HttpResponse.json({ items: [], pageNumber: 1, pageSize: 10, hasNextPage: false });
      }),
      http.post("https://api.emporix.io/order-v2/acme/orders/o-1/transitions", () =>
        new HttpResponse(null, { status: 204 }),
      ),
    );
    const { result } = renderHook(
      () => ({ list: useMyOrders(), cancel: useCancelOrder() }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    const before = listCalls;
    await act(async () => {
      await result.current.cancel.mutateAsync("o-1");
    });
    await waitFor(() => expect(listCalls).toBeGreaterThan(before));
  });
});
