import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useCheckout } from "../src/hooks/use-checkout";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
  http.post("https://api.emporix.io/checkout/acme/checkouts/order", ({ request }) => {
    expect(request.headers.get("saas-token")).toBe("SAAS");
    return HttpResponse.json({ orderId: "EON5", paymentDetails: null, checkoutId: null });
  }),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap(storage = createMemoryStorage({ initial: "cust" })) {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={qc}>
      {children}
    </EmporixProvider>
  );
}

describe("useCheckout", () => {
  it("places an order using the stored customer token + provided saasToken", async () => {
    const { result } = renderHook(() => useCheckout(), { wrapper: wrap() });
    let orderId: string | undefined;
    await act(async () => {
      const r = await result.current.placeOrder.mutateAsync({
        input: {
          cartId: "c1",
          customer: { email: "a@b.co", id: "x" },
          shipping: { methodId: "m", zoneId: "z", methodName: "DHL", amount: 0 },
          addresses: [
            { contactName: "A", street: "S", zipCode: "1", city: "B", country: "DE", type: "SHIPPING" },
            { contactName: "A", street: "S", zipCode: "1", city: "B", country: "DE", type: "BILLING" },
          ],
          paymentMethods: [{ provider: "none" }],
        },
        saasToken: "SAAS",
      });
      orderId = r.orderId;
    });
    expect(orderId).toBe("EON5");
  });

  it("places an order anonymously when no customer token is stored", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.post(
        "https://api.emporix.io/checkout/acme/checkouts/order",
        ({ request }) => {
          seenAuth = request.headers.get("authorization");
          return HttpResponse.json({ orderId: "EON-anon", paymentDetails: null, checkoutId: null });
        },
      ),
    );
    const storage = createMemoryStorage(); // no initial token → anonymous
    const { result } = renderHook(() => useCheckout(), { wrapper: wrap(storage) });
    let orderId: string | undefined;
    await act(async () => {
      const r = await result.current.placeOrder.mutateAsync({
        input: {
          cartId: "c-anon",
          customer: { email: "g@e.com", firstName: "G", lastName: "X", guest: true },
          shipping: { methodId: "m", zoneId: "z", methodName: "DHL", amount: 0 },
          addresses: [],
          paymentMethods: [{ provider: "custom", amount: 1 }],
        },
      });
      orderId = r.orderId;
    });
    expect(orderId).toBe("EON-anon");
    expect(seenAuth).toBe("Bearer anon");
  });

  it("resets the cart after a successful order so the next checkout bootstraps a fresh cart", async () => {
    // The server CLOSES the cart when an order is placed. If the bootstrap cache
    // (staleTime: Infinity) and storage.cartId are not dropped, the next
    // checkout re-adopts the closed cart → cart GET 404, placeOrder 401.
    const storage = createMemoryStorage({ initial: "cust" });
    storage.setCartId("closed-cart-1");
    const client = new EmporixClient({
      tenant: "acme",
      credentials: { storefront: { clientId: "sf" } },
      logger: false,
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const bootstrapKey = [
      "emporix",
      "cart-bootstrap",
      { tenant: "acme", authKind: "customer", siteCode: "main" },
    ];
    qc.setQueryData(bootstrapKey, { id: "closed-cart-1" });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <EmporixProvider client={client} storage={storage} queryClient={qc}>
        {children}
      </EmporixProvider>
    );
    const { result } = renderHook(() => useCheckout(), { wrapper });
    await act(async () => {
      await result.current.placeOrder.mutateAsync({
        input: {
          cartId: "closed-cart-1",
          customer: { email: "a@b.co", id: "x" },
          shipping: { methodId: "m", zoneId: "z", methodName: "DHL", amount: 0 },
          addresses: [
            { contactName: "A", street: "S", zipCode: "1", city: "B", country: "DE", type: "SHIPPING" },
            { contactName: "A", street: "S", zipCode: "1", city: "B", country: "DE", type: "BILLING" },
          ],
          paymentMethods: [{ provider: "none" }],
        },
        saasToken: "SAAS",
      });
    });
    // Closed cart dropped: next useActiveCart({create:true}) bootstraps a fresh one.
    expect(storage.getCartId()).toBeNull();
    expect(qc.getQueryData(bootstrapKey)).toBeUndefined();
  });
});
