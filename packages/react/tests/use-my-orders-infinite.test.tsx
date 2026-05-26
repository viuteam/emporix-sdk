import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useMyOrdersInfinite } from "../src/hooks/use-my-orders-infinite";
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

describe("useMyOrdersInfinite", () => {
  it("paginates via hasNextPage and concatenates pages", async () => {
    server.use(
      http.get("https://api.emporix.io/order-v2/acme/orders", ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get("pageNumber") ?? "1");
        if (page === 1) {
          return HttpResponse.json({
            items: [{ id: "o-1", orderNumber: "ORD-1", status: "CREATED", currency: "CHF", totalPrice: { amount: 10, currency: "CHF" }, items: [] }],
            pageNumber: 1, pageSize: 1, hasNextPage: true,
          });
        }
        return HttpResponse.json({
          items: [{ id: "o-2", orderNumber: "ORD-2", status: "CREATED", currency: "CHF", totalPrice: { amount: 20, currency: "CHF" }, items: [] }],
          pageNumber: 2, pageSize: 1, hasNextPage: false,
        });
      }),
    );
    const { result } = renderHook(() => useMyOrdersInfinite({ pageSize: 1 }), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    const all = result.current.data?.pages.flatMap((p) => p.items) ?? [];
    expect(all.map((o) => o.id)).toEqual(["o-1", "o-2"]);
  });
});
