import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useAvailabilities } from "../src/hooks/use-availabilities";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "a", token_type: "Bearer", expires_in: 3600, refresh_token: "r", sessionId: "s",
    }),
  ),
  http.post("https://api.emporix.io/availability/viu/availability/search", () =>
    HttpResponse.json([{ id: "main:p1", productId: "p1", site: "main", available: true }]),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap() {
  const client = new EmporixClient({
    tenant: "viu",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={createMemoryStorage()} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
}

describe("useAvailabilities", () => {
  it("resolves a batch in input order, marking missing products unavailable", async () => {
    const { result } = renderHook(() => useAvailabilities(["p1", "p2"], "main"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((a) => a.productId)).toEqual(["p1", "p2"]);
    expect(result.current.data?.[1]?.available).toBe(false);
  });

  it("is disabled for an empty id list", () => {
    const { result } = renderHook(() => useAvailabilities([], "main"), { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe("idle");
  });
});
