import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useMatchPrices } from "../src/hooks/use-match-prices";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "a", token_type: "Bearer", expires_in: 3600,
      refresh_token: "r", sessionId: "s",
    }),
  ),
  http.post("https://api.emporix.io/price/viu/match-prices-by-context", () =>
    HttpResponse.json([{ priceId: "pr1", effectiveValue: 12.5 }]),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap() {
  const client = new EmporixClient({
    tenant: "viu",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={createMemoryStorage()} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
}

describe("useMatchPrices", () => {
  it("resolves prices for the given items", async () => {
    const { result } = renderHook(
      () =>
        useMatchPrices({
          items: [{ itemId: { itemType: "PRODUCT", id: "p1" }, quantity: { quantity: 1 } }],
        }),
      { wrapper: wrap() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.effectiveValue).toBe(12.5);
  });

  it("is disabled when there are no items", () => {
    const { result } = renderHook(() => useMatchPrices({ items: [] }), { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("uses the customer token when provided", async () => {
    let authHeader = "";
    server.use(
      http.post("https://api.emporix.io/price/viu/match-prices-by-context", ({ request }) => {
        authHeader = request.headers.get("authorization") ?? "";
        return HttpResponse.json([{ priceId: "pr2", effectiveValue: 7 }]);
      }),
    );
    const { result } = renderHook(
      () =>
        useMatchPrices(
          { items: [{ itemId: { itemType: "PRODUCT", id: "p1" }, quantity: { quantity: 1 } }] },
          { customerToken: "cust-tok" },
        ),
      { wrapper: wrap() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(authHeader).toBe("Bearer cust-tok");
  });
});
