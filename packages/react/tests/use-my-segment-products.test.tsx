import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import {
  useMySegmentProducts,
  useMySegmentProductsInfinite,
} from "../src/hooks/use-my-segments";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customer-segment/acme/segments/items", ({ request }) => {
    const pn = Number(new URL(request.url).searchParams.get("pageNumber") ?? "1");
    if (pn === 1) {
      return HttpResponse.json([
        { type: "PRODUCT", item: { id: "p1" } },
        { type: "PRODUCT", item: { id: "p2" } },
      ]);
    }
    if (pn === 2) {
      return HttpResponse.json([{ type: "PRODUCT", item: { id: "p3" } }]);
    }
    return HttpResponse.json([]);
  }),
  http.post("https://api.emporix.io/product/acme/products/search", async ({ request }) => {
    const body = (await request.json()) as { q?: string };
    const ids = (body.q ?? "")
      .replace(/^id:\(/, "")
      .replace(/\)$/, "")
      .split(",")
      .filter(Boolean);
    return HttpResponse.json(ids.map((id) => ({ id })));
  }),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap(storage = createMemoryStorage()) {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
}

describe("useMySegmentProducts (single page)", () => {
  it("returns the PaginatedItems<Product> shape", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    const { result } = renderHook(
      () => useMySegmentProducts({ pageSize: 2 }),
      { wrapper: wrap(storage) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items.map((p) => (p as { id?: string }).id)).toEqual([
      "p1",
      "p2",
    ]);
    expect(result.current.data?.pageNumber).toBe(1);
    expect(result.current.data?.pageSize).toBe(2);
    expect(result.current.data?.hasNextPage).toBe(true);
  });

  it("is disabled when no customer token is stored", () => {
    const { result } = renderHook(() => useMySegmentProducts(), { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
  });
});

describe("useMySegmentProductsInfinite", () => {
  it("fetches page 1 then page 2 via fetchNextPage; hasNextPage flips false", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    const { result } = renderHook(
      () => useMySegmentProductsInfinite({ pageSize: 2 }),
      { wrapper: wrap(storage) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages).toHaveLength(1);
    expect(result.current.hasNextPage).toBe(true);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    const all = (result.current.data?.pages ?? []).flatMap((p) => p.items);
    expect(all.map((p) => (p as { id?: string }).id)).toEqual(["p1", "p2", "p3"]);
    expect(result.current.hasNextPage).toBe(false);
  });
});
