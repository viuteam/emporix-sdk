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

function wrapper(
  storage = createMemoryStorage(),
  opts: { siteCode?: string } = {},
) {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: {
      backend: { clientId: "b", secret: "s" },
      storefront: {
        clientId: "sf",
        ...(opts.siteCode !== undefined ? { context: { siteCode: opts.siteCode } } : {}),
      },
    },
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

  it("socialLogin stores the token", async () => {
    server.use(
      http.post("https://api.emporix.io/customer/acme/socialLogin", () =>
        HttpResponse.json({
          access_token: "sso-cust",
          saas_token: "saas",
          refresh_token: "sso-rt",
          expires_in: "14399",
        }),
      ),
    );
    const storage = createMemoryStorage();
    const { result } = renderHook(() => useCustomerSession(), { wrapper: wrapper(storage) });
    await act(async () => {
      await result.current.socialLogin({ code: "c", redirectUri: "https://shop/cb" });
    });
    expect(storage.getCustomerToken()).toBe("sso-cust");
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.refreshToken).toBe("sso-rt");
  });

  it("exchangeToken stores the token", async () => {
    server.use(
      http.post("https://api.emporix.io/customer/acme/exchangeauthtoken", () =>
        HttpResponse.json({
          access_token: "ex-cust",
          saas_token: "saas",
          refresh_token: "ex-rt",
          expires_in: 14399,
          session_id: "s9",
        }),
      ),
    );
    const storage = createMemoryStorage();
    const { result } = renderHook(() => useCustomerSession(), { wrapper: wrapper(storage) });
    await act(async () => {
      await result.current.exchangeToken({ subjectToken: "idp-jwt", config: "Site_DE" });
    });
    expect(storage.getCustomerToken()).toBe("ex-cust");
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.refreshToken).toBe("ex-rt");
  });
});

describe("useCustomerSession — cart onboarding on login", () => {
  it("loads the customer cart and writes cartId to storage", async () => {
    let getCurrentCall: URLSearchParams | undefined;
    server.use(
      http.get("https://api.emporix.io/cart/acme/carts", ({ request }) => {
        getCurrentCall = new URL(request.url).searchParams;
        return HttpResponse.json({ id: "cust-cart", items: [] });
      }),
    );
    const storage = createMemoryStorage();
    const { result } = renderHook(() => useCustomerSession(), {
      wrapper: wrapper(storage, { siteCode: "main" }),
    });
    await act(async () => {
      await result.current.login({ email: "a@b.co", password: "x" });
    });
    expect(getCurrentCall?.get("siteCode")).toBe("main");
    expect(getCurrentCall?.get("create")).toBe("true");
    expect(storage.getCartId()).toBe("cust-cart");
  });

  it("merges the anonymous cartId from storage into the customer cart", async () => {
    let mergeBody: { carts?: string[] } | undefined;
    server.use(
      http.get("https://api.emporix.io/cart/acme/carts", () =>
        HttpResponse.json({ id: "cust-cart", items: [] }),
      ),
      http.post(
        "https://api.emporix.io/cart/acme/carts/cust-cart/merge",
        async ({ request }) => {
          mergeBody = (await request.json()) as { carts?: string[] };
          return HttpResponse.json({ id: "cust-cart" });
        },
      ),
    );
    const storage = createMemoryStorage();
    storage.setCartId("anon-cart");
    const { result } = renderHook(() => useCustomerSession(), {
      wrapper: wrapper(storage, { siteCode: "main" }),
    });
    await act(async () => {
      await result.current.login({ email: "a@b.co", password: "x" });
    });
    expect(mergeBody?.carts).toEqual(["anon-cart"]);
    expect(storage.getCartId()).toBe("cust-cart");
  });

  it("skips cart onboarding when storefront context.siteCode is missing", async () => {
    let getCalled = false;
    server.use(
      http.get("https://api.emporix.io/cart/acme/carts", () => {
        getCalled = true;
        return HttpResponse.json({ id: "x", items: [] });
      }),
    );
    const storage = createMemoryStorage();
    const { result } = renderHook(() => useCustomerSession(), {
      wrapper: wrapper(storage), // no siteCode
    });
    await act(async () => {
      await result.current.login({ email: "a@b.co", password: "x" });
    });
    expect(getCalled).toBe(false);
    expect(storage.getCartId()).toBeNull();
  });

  it("login resolves even if cart onboarding throws (best-effort)", async () => {
    server.use(
      http.get("https://api.emporix.io/cart/acme/carts", () =>
        HttpResponse.json({ message: "boom" }, { status: 500 }),
      ),
    );
    const storage = createMemoryStorage();
    const { result } = renderHook(() => useCustomerSession(), {
      wrapper: wrapper(storage, { siteCode: "main" }),
    });
    await act(async () => {
      await expect(
        result.current.login({ email: "a@b.co", password: "x" }),
      ).resolves.not.toThrow();
    });
    expect(storage.getCustomerToken()).not.toBeNull(); // login still succeeded
    expect(storage.getCartId()).toBeNull(); // cart-id stayed empty
  });
});
