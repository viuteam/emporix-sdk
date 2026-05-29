import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useMatchPricesChunked } from "../src/hooks/use-match-prices-chunked";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "a", token_type: "Bearer", expires_in: 3600, refresh_token: "r", sessionId: "s",
    }),
  ),
  http.post("https://api.emporix.io/price/viu/match-prices-by-context", async ({ request }) => {
    const body = (await request.json()) as { items?: { itemId?: { id?: string } }[] };
    return HttpResponse.json(
      (body.items ?? []).map((it) => ({
        priceId: `pr-${it.itemId?.id}`,
        itemRef: { id: it.itemId?.id },
        effectiveValue: 1,
      })),
    );
  }),
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

const items = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    itemId: { itemType: "PRODUCT", id: `p${i}` },
    quantity: { quantity: 1 },
  }));

describe("useMatchPricesChunked", () => {
  it("aggregates prices across chunks", async () => {
    const { result } = renderHook(
      () => useMatchPricesChunked({ items: items(5) }, { chunkSize: 2 }),
      { wrapper: wrap() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(5);
  });

  it("is disabled when there are no items", () => {
    const { result } = renderHook(() => useMatchPricesChunked({ items: [] }), { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe("idle");
  });
});
