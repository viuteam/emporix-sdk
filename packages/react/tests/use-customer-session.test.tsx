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
    HttpResponse.json({ id: "c1", contactEmail: "a@b.co" }),
  ),
  http.get(
    "https://api.emporix.io/customer/acme/logout",
    () => new HttpResponse(null, { status: 204 }),
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
    await waitFor(() => expect(result.current.customer?.contactEmail).toBe("a@b.co"));
  });

  it("logout calls the server then clears the token", async () => {
    let logoutHit = false;
    server.use(
      http.get("https://api.emporix.io/customer/acme/logout", ({ request }) => {
        logoutHit = true;
        expect(new URL(request.url).searchParams.get("accessToken")).toBe("cust");
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const storage = createMemoryStorage({ initial: "cust" });
    const { result } = renderHook(() => useCustomerSession(), { wrapper: wrapper(storage) });
    expect(result.current.isAuthenticated).toBe(true);
    await act(async () => {
      await result.current.logout();
    });
    expect(logoutHit).toBe(true);
    expect(storage.getCustomerToken()).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("logout still clears locally when the server logout fails", async () => {
    server.use(
      http.get(
        "https://api.emporix.io/customer/acme/logout",
        () => new HttpResponse(null, { status: 401 }),
      ),
    );
    const storage = createMemoryStorage({ initial: "cust" });
    const { result } = renderHook(() => useCustomerSession(), { wrapper: wrapper(storage) });
    await act(async () => {
      await result.current.logout();
    });
    expect(storage.getCustomerToken()).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("refreshSession is a no-op without a refresh token", async () => {
    const { result } = renderHook(() => useCustomerSession(), { wrapper: wrapper() });
    await act(async () => {
      await result.current.refreshSession();
    });
    expect(result.current.customerToken).toBeNull();
  });

  it("refreshSession exchanges the refresh token and updates the stored token", async () => {
    let refreshHit = false;
    server.use(
      http.get("https://api.emporix.io/customer/acme/refreshauthtoken", ({ request }) => {
        refreshHit = true;
        const u = new URL(request.url);
        expect(u.searchParams.get("refreshToken")).toBe("crt");
        return HttpResponse.json({
          access_token: "cust-2",
          refresh_token: "crt-2",
          expires_in: 3600,
          session_id: "s",
        });
      }),
    );
    const storage = createMemoryStorage();
    const { result } = renderHook(() => useCustomerSession(), { wrapper: wrapper(storage) });
    await act(async () => {
      await result.current.login({ email: "a@b.co", password: "p" });
    });
    expect(result.current.refreshToken).toBe("crt");
    await act(async () => {
      await result.current.refreshSession();
    });
    expect(refreshHit).toBe(true);
    expect(storage.getCustomerToken()).toBe("cust-2");
    expect(result.current.customerToken).toBe("cust-2");
    expect(result.current.refreshToken).toBe("crt-2");
  });

  it("refreshSession keeps the old refresh token when none is returned and no saas exists", async () => {
    server.use(
      http.post("https://api.emporix.io/customer/acme/login", () =>
        HttpResponse.json({ accessToken: "cust", refreshToken: "crt" }),
      ),
      http.get("https://api.emporix.io/customer/acme/refreshauthtoken", () =>
        HttpResponse.json({ access_token: "cust-3", expires_in: 3600 }),
      ),
    );
    const storage = createMemoryStorage();
    const { result } = renderHook(() => useCustomerSession(), { wrapper: wrapper(storage) });
    await act(async () => {
      await result.current.login({ email: "a@b.co", password: "p" });
    });
    await act(async () => {
      await result.current.refreshSession();
    });
    expect(result.current.customerToken).toBe("cust-3");
    expect(result.current.refreshToken).toBe("crt"); // unchanged
  });
});
