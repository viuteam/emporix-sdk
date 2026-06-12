import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useMyCompanies } from "../src/hooks/use-my-companies";
import { useCompany } from "../src/hooks/use-company";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "anon-rt", sessionId: "s",
    }),
  ),
  http.get("https://api.emporix.io/customer-management/acme/legal-entities", () =>
    HttpResponse.json([{ id: "le-1", name: "Acme", type: "COMPANY" }]),
  ),
  http.get("https://api.emporix.io/customer-management/acme/legal-entities/le-1", () =>
    HttpResponse.json({ id: "le-1", name: "Acme Detailed", type: "COMPANY" }),
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

describe("useMyCompanies / useCompany", () => {
  it("useMyCompanies returns the assigned companies", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    const { result } = renderHook(() => useMyCompanies(), { wrapper: wrap(storage) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.id).toBe("le-1");
  });

  it("useMyCompanies is disabled without a customer token", () => {
    const { result } = renderHook(() => useMyCompanies(), { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("useCompany fetches one by id", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    const { result } = renderHook(() => useCompany("le-1"), { wrapper: wrap(storage) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.name).toBe("Acme Detailed");
  });

  it("starts fetching when a login token appears in storage (reactive enabled-gate)", async () => {
    const storage = createMemoryStorage(); // no token: hook disabled, no fetch
    const { result } = renderHook(() => useMyCompanies(), { wrapper: wrap(storage) });
    expect(result.current.fetchStatus).toBe("idle");
    act(() => storage.setCustomerToken("cust"));
    // Pre-fix this NEVER fires: the raw storage read doesn't re-render the hook.
    await waitFor(() => expect(result.current.data?.length).toBeGreaterThan(0));
  });
});
