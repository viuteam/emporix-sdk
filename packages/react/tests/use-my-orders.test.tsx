import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useMyOrders } from "../src/hooks/use-my-orders";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "anon-rt", sessionId: "s",
    }),
  ),
  http.get("https://api.emporix.io/customer-management/acme/legal-entities", () =>
    HttpResponse.json([]),
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

describe("useMyOrders", () => {
  it("is disabled without a customer token", () => {
    const { result } = renderHook(() => useMyOrders(), { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("fetches the customer's orders", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    server.use(
      http.get("https://api.emporix.io/order-v2/acme/orders", () =>
        // order-v2 returns a bare array (count in X-Total-Count), not an envelope.
        HttpResponse.json(
          [{ id: "o-1", status: "CREATED", currency: "CHF", totalPrice: 10, entries: [] }],
          { headers: { "X-Total-Count": "1" } },
        ),
      ),
    );
    const { result } = renderHook(() => useMyOrders(), { wrapper: wrap(storage) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items[0]?.id).toBe("o-1");
  });

  it("forwards pagination, status, saasToken and explicit legalEntityId", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    let q: URLSearchParams | null = null;
    let saas: string | null = null;
    server.use(
      http.get("https://api.emporix.io/order-v2/acme/orders", ({ request }) => {
        q = new URL(request.url).searchParams;
        saas = request.headers.get("saas-token");
        return HttpResponse.json([]);
      }),
    );
    const { result } = renderHook(
      () => useMyOrders({ pageNumber: 2, pageSize: 5, status: "SHIPPED", legalEntityId: "le-1", saasToken: "saas-xyz" }),
      { wrapper: wrap(storage) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect((q as URLSearchParams | null)?.get("pageNumber")).toBe("2");
    expect((q as URLSearchParams | null)?.get("status")).toBe("SHIPPED");
    expect((q as URLSearchParams | null)?.get("legalEntityId")).toBe("le-1");
    expect(saas).toBe("saas-xyz");
  });

  it("defaults legalEntityId from the active company", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    storage.setRefreshToken("r");
    let leSeen: string | null = null;
    server.use(
      http.get("https://api.emporix.io/customer-management/acme/legal-entities", () =>
        HttpResponse.json([{ id: "le-1", name: "Acme", type: "COMPANY" }]),
      ),
      http.get("https://api.emporix.io/customer/acme/refreshauthtoken", () =>
        HttpResponse.json({ access_token: "scoped", refresh_token: "r2" }),
      ),
      http.get("https://api.emporix.io/order-v2/acme/orders", ({ request }) => {
        leSeen = new URL(request.url).searchParams.get("legalEntityId");
        return HttpResponse.json([]);
      }),
    );
    const { result } = renderHook(() => useMyOrders(), { wrapper: wrap(storage) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(leSeen).toBe("le-1");
  });

  it("explicit legalEntityId: null disables the auto-default", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    storage.setRefreshToken("r");
    let leSeen: string | null = "unset";
    server.use(
      http.get("https://api.emporix.io/customer-management/acme/legal-entities", () =>
        HttpResponse.json([{ id: "le-1", name: "Acme", type: "COMPANY" }]),
      ),
      http.get("https://api.emporix.io/customer/acme/refreshauthtoken", () =>
        HttpResponse.json({ access_token: "scoped", refresh_token: "r2" }),
      ),
      http.get("https://api.emporix.io/order-v2/acme/orders", ({ request }) => {
        leSeen = new URL(request.url).searchParams.get("legalEntityId");
        return HttpResponse.json([]);
      }),
    );
    const { result } = renderHook(() => useMyOrders({ legalEntityId: null }), { wrapper: wrap(storage) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(leSeen).toBeNull();
  });

  it("sends a built filter as q", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    let seen: URLSearchParams | undefined;
    server.use(
      http.get("https://api.emporix.io/order-v2/acme/orders", ({ request }) => {
        seen = new URL(request.url).searchParams;
        return HttpResponse.json(
          [{ id: "o-1", status: "CREATED", currency: "CHF", totalPrice: 1, entries: [] }],
          { headers: { "X-Total-Count": "1" } },
        );
      }),
    );
    const filter = { toString: () => "mixins.orderAttrs.priority:high", usesCompound: false };
    const { result } = renderHook(() => useMyOrders({ q: filter, legalEntityId: null }), {
      wrapper: wrap(storage),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seen?.get("q")).toBe("mixins.orderAttrs.priority:high");
  });
});
