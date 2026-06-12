import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, dehydrate } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { EmporixClient, auth } from "@viu/emporix-sdk";
import { prefetchProduct, prefetchOrder } from "../src/ssr";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useProduct } from "../src/hooks/use-products";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
  http.get("https://api.emporix.io/product/acme/products/p1", () =>
    HttpResponse.json({ id: "p1", name: "Widget" }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("ssr", () => {
  it("prefetchProduct fills a QueryClient that dehydrates", async () => {
    const client = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    const qc = new QueryClient();
    await prefetchProduct(qc, client, "p1", auth.anonymous());
    const state = dehydrate(qc);
    expect(JSON.stringify(state)).toContain("Widget");
  });

  it("prefetchProduct writes the exact key useProduct reads (zero client refetch)", async () => {
    let productHits = 0;
    server.use(
      http.get("https://api.emporix.io/product/acme/products/p1", () => {
        productHits += 1;
        return HttpResponse.json({ id: "p1", name: "Prefetched" });
      }),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
    const client = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    await prefetchProduct(qc, client, "p1"); // server side: anonymous, no site ctx
    expect(productHits).toBe(1);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <EmporixProvider client={client} storage={createMemoryStorage()} queryClient={qc}>
        {children}
      </EmporixProvider>
    );
    const { result } = renderHook(() => useProduct("p1"), { wrapper });
    // Cache hit: data is available synchronously, and no second request fires.
    expect(result.current.data).toEqual({ id: "p1", name: "Prefetched" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(productHits).toBe(1);
  });
});

describe("prefetchOrder", () => {
  it("prefetches the same cache key useOrder would read", async () => {
    server.use(
      http.get("https://api.emporix.io/order-v2/acme/orders/o-1", () =>
        HttpResponse.json({
          id: "o-1", orderNumber: "ORD-1", status: "CREATED",
          currency: "CHF", totalPrice: { amount: 10, currency: "CHF" }, items: [],
        }),
      ),
    );
    const client = new EmporixClient({
      tenant: "acme",
      credentials: { storefront: { clientId: "sf" } },
      logger: false,
    });
    const qc = new QueryClient();
    await prefetchOrder(qc, client, "o-1", auth.customer("cust"));
    const cached = qc.getQueryData([
      "emporix",
      "orders",
      "o-1",
      { tenant: "acme", authKind: "customer", language: null },
    ]);
    expect((cached as { orderNumber?: string } | undefined)?.orderNumber).toBe("ORD-1");
  });

  it("forwards opts.saasToken as the saas-token header", async () => {
    let saas: string | null = null;
    server.use(
      http.get("https://api.emporix.io/order-v2/acme/orders/o-2", ({ request }) => {
        saas = request.headers.get("saas-token");
        return HttpResponse.json({
          id: "o-2", orderNumber: "ORD-2", status: "CREATED",
          currency: "CHF", totalPrice: { amount: 10, currency: "CHF" }, items: [],
        });
      }),
    );
    const client = new EmporixClient({
      tenant: "acme",
      credentials: { storefront: { clientId: "sf" } },
      logger: false,
    });
    await prefetchOrder(new QueryClient(), client, "o-2", auth.customer("cust"), {
      saasToken: "saas-xyz",
    });
    expect(saas).toBe("saas-xyz");
  });
});
