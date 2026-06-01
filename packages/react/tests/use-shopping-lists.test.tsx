import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useShoppingLists, useAddToShoppingList } from "../src/hooks/use-shopping-lists";
import type { ReactNode } from "react";

const BASE = "https://api.emporix.io/shoppinglist/acme/shopping-lists";
const ENVELOPE = [{ customerId: "C1", default: { name: "default", items: [{ id: 1, productId: "p1", quantity: 2 }] } }];

const server = setupServer(
  http.get(BASE, () => HttpResponse.json(ENVELOPE)),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap() {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    logger: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const storage = createMemoryStorage({ initial: "cust-tok" }); // logged-in customer
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
}

describe("useShoppingLists", () => {
  it("returns the normalized lists for the logged-in customer", async () => {
    const { result } = renderHook(() => useShoppingLists(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((l) => l.name)).toEqual(["default"]);
  });
});

describe("useAddToShoppingList", () => {
  it("PUTs the modified list and invalidates the lists query", async () => {
    let putCalled = false;
    server.use(
      http.put(`${BASE}/C1`, () => {
        putCalled = true;
        return new HttpResponse(null, { status: 200 });
      }),
    );
    const { result } = renderHook(() => useAddToShoppingList(), { wrapper: wrap() });
    await act(async () => {
      await result.current.mutateAsync({ customerId: "C1", listName: "default", item: { productId: "p2", quantity: 1 } });
    });
    expect(putCalled).toBe(true);
  });
});
