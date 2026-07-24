import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { usePaymentModes, usePaymentMode, useInitializePayment } from "../src/hooks/use-checkout";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon",
      token_type: "Bearer",
      expires_in: 3599,
      refresh_token: "rt",
      sessionId: "s",
    }),
  ),
  http.get("https://api.emporix.io/payment-gateway/acme/paymentmodes/frontend", () =>
    HttpResponse.json([{ id: "m1", code: "card", integrationType: "OFFSITE" }]),
  ),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap(storage = createMemoryStorage()) {
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

describe("usePaymentModes", () => {
  it("lists payment modes for a guest (anonymous) session", async () => {
    const { result } = renderHook(() => usePaymentModes(), {
      wrapper: wrap(createMemoryStorage()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.code).toBe("card");
  });

  it("lists payment modes for a logged-in customer", async () => {
    const { result } = renderHook(() => usePaymentModes(), {
      wrapper: wrap(createMemoryStorage({ initial: "cust" })),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.code).toBe("card");
  });
});

describe("usePaymentMode / useInitializePayment", () => {
  it("usePaymentMode fetches one frontend mode", async () => {
    server.use(
      http.get("https://api.emporix.io/payment-gateway/acme/paymentmodes/frontend/pm1", () =>
        HttpResponse.json({ id: "pm1", code: "CARD" }),
      ),
    );
    const { result } = renderHook(() => usePaymentMode("pm1"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe("pm1");
  });

  it("useInitializePayment POSTs the initialize request", async () => {
    server.use(
      http.post("https://api.emporix.io/payment-gateway/acme/payment/frontend/initialize", () =>
        HttpResponse.json({ paymentId: "p1" }),
      ),
    );
    const { result } = renderHook(() => useInitializePayment(), { wrapper: wrap() });
    await act(async () => {
      await result.current.mutateAsync({ orderId: "o1" } as never);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});
