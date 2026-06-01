import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useValidateCoupon, useRedeemCoupon } from "../src/hooks/use-coupons";
import type { ReactNode } from "react";

const BASE = "https://api.emporix.io/coupon/acme/coupons/SUMMER";
const REDEMPTION = {
  orderCode: "O1",
  orderTotal: { amount: 100, currency: "EUR" },
  discount: { amount: 10, currency: "EUR" },
};

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

describe("useValidateCoupon", () => {
  it("POSTs to /validation with the customer token and succeeds", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.post(`${BASE}/validation`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return new HttpResponse(null, { status: 200 });
      }),
    );
    const { result } = renderHook(() => useValidateCoupon(), { wrapper: wrap() });
    await act(async () => {
      await result.current.mutateAsync({ code: "SUMMER", redemption: REDEMPTION });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenAuth).toBe("Bearer cust-tok");
  });
});

describe("useRedeemCoupon", () => {
  it("POSTs to /redemptions and returns the resource location", async () => {
    server.use(
      http.post(`${BASE}/redemptions`, () => HttpResponse.json({ id: "r1" }, { status: 201 })),
    );
    const { result } = renderHook(() => useRedeemCoupon(), { wrapper: wrap() });
    await act(async () => {
      await result.current.mutateAsync({ code: "SUMMER", redemption: REDEMPTION });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe("r1");
  });
});
