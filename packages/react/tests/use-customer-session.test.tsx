import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useCustomerSession } from "../src/hooks/use-customer-session";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
  http.post("https://api.emporix.io/customer/acme/login", () =>
    HttpResponse.json({ accessToken: "cust", saasToken: "saas", refreshToken: "crt" }),
  ),
  http.get("https://api.emporix.io/customer/acme/me", () =>
    HttpResponse.json({ id: "c1", email: "a@b.co" }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrapper(storage = createMemoryStorage()) {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    logger: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
}

describe("useCustomerSession", () => {
  it("starts unauthenticated", () => {
    const { result } = renderHook(() => useCustomerSession(), { wrapper: wrapper() });
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.customerToken).toBeNull();
  });

  it("login stores the token and fetches the customer", async () => {
    const storage = createMemoryStorage();
    const { result } = renderHook(() => useCustomerSession(), { wrapper: wrapper(storage) });
    await act(async () => {
      await result.current.login({ email: "a@b.co", password: "p" });
    });
    expect(storage.getCustomerToken()).toBe("cust");
    expect(result.current.isAuthenticated).toBe(true);
    await waitFor(() => expect(result.current.customer?.email).toBe("a@b.co"));
  });

  it("logout clears the token", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    const { result } = renderHook(() => useCustomerSession(), { wrapper: wrapper(storage) });
    expect(result.current.isAuthenticated).toBe(true);
    act(() => result.current.logout());
    expect(storage.getCustomerToken()).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });
});
