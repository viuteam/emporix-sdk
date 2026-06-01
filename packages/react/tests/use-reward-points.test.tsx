import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import {
  useMyRewardPoints,
  useMyRewardPointsSummary,
  useRedeemRewardPoints,
  useRedeemOptions,
} from "../src/hooks/use-reward-points";
import type { ReactNode } from "react";

const RP = "https://api.emporix.io/reward-points";

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

describe("useMyRewardPoints", () => {
  it("reads /public/customer with the customer token", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(`${RP}/public/customer`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json(42);
      }),
    );
    const { result } = renderHook(() => useMyRewardPoints(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenAuth).toBe("Bearer cust-tok");
    expect(result.current.data).toBe(42);
  });
});

describe("useMyRewardPointsSummary", () => {
  it("reads /public/customer/summary", async () => {
    server.use(http.get(`${RP}/public/customer/summary`, () => HttpResponse.json({ openPoints: 10 })));
    const { result } = renderHook(() => useMyRewardPointsSummary(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe("useRedeemOptions", () => {
  it("lists the tenant-scoped redeem options", async () => {
    server.use(http.get(`${RP}/acme/redeemOptions`, () => HttpResponse.json([{ id: "opt-1" }])));
    const { result } = renderHook(() => useRedeemOptions(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
  });
});

describe("useRedeemRewardPoints", () => {
  it("redeems points and returns the coupon code", async () => {
    server.use(http.post(`${RP}/public/customer/redeem`, () => HttpResponse.json({ code: "WELCOME10" })));
    const { result } = renderHook(() => useRedeemRewardPoints(), { wrapper: wrap() });
    await act(async () => {
      await result.current.mutateAsync({ redeemOptionId: "opt-1" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.code).toBe("WELCOME10");
  });
});
