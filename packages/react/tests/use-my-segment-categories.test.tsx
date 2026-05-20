import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import {
  useMySegmentCategories,
  useMySegmentCategoriesInfinite,
} from "../src/hooks/use-my-segments";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customer-segment/acme/segments/items", ({ request }) => {
    const pn = Number(new URL(request.url).searchParams.get("pageNumber") ?? "1");
    if (pn === 1) {
      return HttpResponse.json([
        { type: "CATEGORY", item: { id: "c1" } },
        { type: "CATEGORY", item: { id: "c2" } },
      ]);
    }
    if (pn === 2) {
      return HttpResponse.json([{ type: "CATEGORY", item: { id: "c3" } }]);
    }
    return HttpResponse.json([]);
  }),
  http.post(
    "https://api.emporix.io/category/acme/categories/search",
    async ({ request }) => {
      const body = (await request.json()) as { q?: string };
      const ids = (body.q ?? "")
        .replace(/^id:\(/, "")
        .replace(/\)$/, "")
        .split(",")
        .filter(Boolean);
      return HttpResponse.json(ids.map((id) => ({ id })));
    },
  ),
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

describe("useMySegmentCategories / Infinite", () => {
  it("single-page returns PaginatedItems<Category>", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    const { result } = renderHook(
      () => useMySegmentCategories({ pageSize: 2 }),
      { wrapper: wrap(storage) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items.map((c) => (c as { id?: string }).id)).toEqual([
      "c1",
      "c2",
    ]);
    expect(result.current.data?.hasNextPage).toBe(true);
  });

  it("infinite fetches pages with fetchNextPage", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    const { result } = renderHook(
      () => useMySegmentCategoriesInfinite({ pageSize: 2 }),
      { wrapper: wrap(storage) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    const all = (result.current.data?.pages ?? []).flatMap((p) => p.items);
    expect(all.map((c) => (c as { id?: string }).id)).toEqual(["c1", "c2", "c3"]);
    expect(result.current.hasNextPage).toBe(false);
  });
});
