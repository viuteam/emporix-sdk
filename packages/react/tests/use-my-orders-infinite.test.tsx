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
    let calls = 0;
    server.use(
      http.get("https://api.emporix.io/order-v2/acme/orders", ({ request }) => {
        calls += 1;
        const page = Number(new URL(request.url).searchParams.get("pageNumber") ?? "1");
        // order-v2 returns a bare array; the hook derives hasNextPage from a
        // full page (items.length === pageSize), so a short final page ends it.
        return page === 1
          ? HttpResponse.json([{ id: "o-1" }, { id: "o-2" }], { headers: { "X-Total-Count": "3" } })
          : HttpResponse.json([{ id: "o-3" }], { headers: { "X-Total-Count": "3" } });
      }),
    );
    const { result } = renderHook(() => useMyOrdersInfinite({ pageSize: 2 }), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    expect(calls).toBe(2);
    const all = result.current.data?.pages.flatMap((p) => p.items) ?? [];
    expect(all.map((o) => o.id)).toEqual(["o-1", "o-2", "o-3"]);
  });
});
