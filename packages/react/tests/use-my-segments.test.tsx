import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import {
  useMySegments,
  useMySegmentItems,
  useMySegmentCategoryTree,
} from "../src/hooks/use-my-segments";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customer-segment/acme/segments", ({ request }) => {
    expect(request.headers.get("authorization")).toBe("Bearer cust");
    return HttpResponse.json([{ id: "seg-1" }]);
  }),
  http.get("https://api.emporix.io/customer-segment/acme/segments/items", () =>
    HttpResponse.json([{ type: "PRODUCT", item: { id: "p1" } }]),
  ),
  http.get(
    "https://api.emporix.io/customer-segment/acme/segments/items/category-trees",
    () => HttpResponse.json([{ id: "c1", code: "C1", name: { en: "Cat" } }]),
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

describe("useMySegments / useMySegmentItems / useMySegmentCategoryTree", () => {
  it("useMySegments fetches with the customer token", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    const { result } = renderHook(() => useMySegments(), { wrapper: wrap(storage) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });

  it("useMySegments is disabled when no customer token is stored", () => {
    const { result } = renderHook(() => useMySegments(), { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
  });

  it("useMySegmentItems fetches when logged in", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    const { result } = renderHook(
      () => useMySegmentItems({ onlyActive: true }),
      { wrapper: wrap(storage) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]).toMatchObject({ type: "PRODUCT" });
  });

  it("useMySegmentCategoryTree fetches when logged in", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    const { result } = renderHook(
      () => useMySegmentCategoryTree({ siteCode: "main" }),
      { wrapper: wrap(storage) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]).toMatchObject({ id: "c1" });
  });
});
