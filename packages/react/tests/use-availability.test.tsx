import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useAvailability } from "../src/hooks/use-availability";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "a", token_type: "Bearer", expires_in: 3600, refresh_token: "r", sessionId: "s",
    }),
  ),
  http.get("https://api.emporix.io/availability/viu/availability/p1/main", () =>
    HttpResponse.json({ id: "main:p1", productId: "p1", site: "main", available: true, stockLevel: 5 }),
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

describe("useAvailability", () => {
  it("resolves availability for a product + site", async () => {
    const { result } = renderHook(() => useAvailability("p1", "main"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.available).toBe(true);
    expect(result.current.data?.stockLevel).toBe(5);
  });

  it("is disabled when productId or siteCode is empty", () => {
    const { result } = renderHook(() => useAvailability("", "main"), { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe("idle");
  });
});
