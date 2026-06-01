import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useMyReturns, useReturn, useCreateReturn } from "../src/hooks/use-returns";
import type { ReactNode } from "react";

const BASE = "https://api.emporix.io/return/acme/returns";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap() {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    logger: false,
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const storage = createMemoryStorage({ initial: "cust-tok" }); // logged-in customer
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
}

describe("useMyReturns", () => {
  it("lists the customer's returns with the customer token", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(BASE, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json([{ id: "r1" }]);
      }),
    );
    const { result } = renderHook(() => useMyReturns(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenAuth).toBe("Bearer cust-tok");
  });
});

describe("useReturn", () => {
  it("fetches one return", async () => {
    server.use(http.get(`${BASE}/r1`, () => HttpResponse.json({ id: "r1" })));
    const { result } = renderHook(() => useReturn("r1"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect((result.current.data as { id?: string }).id).toBe("r1");
  });
});

describe("useCreateReturn", () => {
  it("creates a return and returns { id }", async () => {
    server.use(http.post(BASE, () => HttpResponse.json({ id: "r1" }, { status: 201 })));
    const { result } = renderHook(() => useCreateReturn(), { wrapper: wrap() });
    await act(async () => {
      await result.current.mutateAsync({ orderId: "o1" } as never);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe("r1");
  });
});
