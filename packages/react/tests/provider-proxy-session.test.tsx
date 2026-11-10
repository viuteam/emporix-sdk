import { describe, it, expect, vi, beforeAll, afterAll, afterEach, beforeEach } from "vitest";
import { render, renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient, PROXY_CUSTOMER_TOKEN, type EmporixConfig } from "@viu/emporix-sdk";
import type { ReactNode } from "react";
import { EmporixProvider, useEmporix, type EmporixProxySession } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useActiveCompany } from "../src/company-context";
import { useProduct } from "../src/hooks/use-products";
import { useCustomerSession } from "../src/hooks/use-customer-session";
import { useConfirmSignup } from "../src/hooks/use-customer-credentials";
import type { EmporixStorage } from "../src/storage";

/** What the proxy saw: path and the two headers that matter. */
const seen: { path: string; authorization: string | null; csrf: string | null }[] = [];
let tokenCalls = 0;

const server = setupServer(
  http.all("*/customerlogin/auth/anonymous/*", () => {
    tokenCalls++;
    return HttpResponse.json({ access_token: "anon", refresh_token: "rt", sessionId: "s", expires_in: 3599 });
  }),
  http.post("*/oauth/token", () => {
    tokenCalls++;
    return HttpResponse.json({ access_token: "svc", expires_in: 3599 });
  }),
  http.all("*/emporix/*", ({ request }) => {
    const path = new URL(request.url).pathname;
    seen.push({
      path,
      authorization: request.headers.get("authorization"),
      csrf: request.headers.get("x-csrf"),
    });
    if (path.endsWith("/me")) return HttpResponse.json({ id: "c1", contactEmail: "c@example.com" });
    return HttpResponse.json({ id: "p1" });
  }),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  seen.length = 0;
  tokenCalls = 0;
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function proxyClient(proxy: EmporixConfig["proxy"] = { headers: { "X-CSRF": "1" } }): EmporixClient {
  return new EmporixClient({ tenant: "acme", host: "/emporix", credentials: {}, logger: false, proxy });
}

function wrap(opts: {
  client?: EmporixClient;
  storage?: EmporixStorage;
  proxySession?: EmporixProxySession;
  onCustomerSessionExpired?: () => void;
} = {}) {
  const c = opts.client ?? proxyClient();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider
      client={c}
      queryClient={qc}
      {...(opts.storage ? { storage: opts.storage } : {})}
      {...(opts.proxySession ? { proxySession: opts.proxySession } : {})}
      {...(opts.onCustomerSessionExpired ? { onCustomerSessionExpired: opts.onCustomerSessionExpired } : {})}
    >
      {children}
    </EmporixProvider>
  );
}

describe("EmporixProvider customerSession='proxy'", () => {
  it("loads a guest read through the proxy without a token anywhere", async () => {
    const storage = createMemoryStorage();
    const { result } = renderHook(() => useProduct("p1"), { wrapper: wrap({ storage }) });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seen).toEqual([{ path: "/emporix/product/acme/products/p1", authorization: null, csrf: "1" }]);
    expect(tokenCalls).toBe(0);
    expect(storage.getCustomerToken()).toBeNull();
    expect(storage.getAnonymousSession()).toBeNull();
  });

  it("takes the customer path when the proxy session is authenticated, still without a token", async () => {
    const storage = createMemoryStorage();
    const { result } = renderHook(
      () => ({ session: useCustomerSession(), emporix: useEmporix() }),
      { wrapper: wrap({ storage, proxySession: { authenticated: true } }) },
    );

    await waitFor(() => expect(result.current.session.customer).not.toBeNull());
    expect(result.current.session.isAuthenticated).toBe(true);
    expect(result.current.session.customerToken).toBe(PROXY_CUSTOMER_TOKEN);
    expect(result.current.emporix.storage.getCustomerToken()).toBe(PROXY_CUSTOMER_TOKEN);
    expect(seen).toEqual([{ path: "/emporix/customer/acme/me", authorization: null, csrf: "1" }]);
    // The marker lives in the provider's view, never in the app's storage.
    expect(storage.getCustomerToken()).toBeNull();
    expect(storage.getRefreshToken()).toBeNull();
    expect(tokenCalls).toBe(0);
  });

  it("follows proxySession.authenticated when it changes", async () => {
    const c = proxyClient();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const states: boolean[] = [];
    function Reader() {
      states.push(useCustomerSession().isAuthenticated);
      return null;
    }
    const Harness = ({ authenticated }: { authenticated: boolean }) => (
      <EmporixProvider client={c} queryClient={qc} proxySession={{ authenticated }}>
        <Reader />
      </EmporixProvider>
    );

    const { rerender } = render(<Harness authenticated={false} />);
    const before = states.length;
    rerender(<Harness authenticated />);

    expect(states[0]).toBe(false);
    // The render that changes the prop already sees it — a stale pass would start
    // its queries on the guest path.
    expect(states.slice(before).length).toBeGreaterThan(0);
    expect(states.slice(before)).not.toContain(false);
    await waitFor(() => expect(seen.map((s) => s.path)).toContain("/emporix/customer/acme/me"));
  });

  it("reports a 401 through onCustomerSessionExpired, without a retry", async () => {
    server.use(http.all("*/emporix/*", () => HttpResponse.json({}, { status: 401 })));
    const onCustomerSessionExpired = vi.fn();
    const { result } = renderHook(() => useProduct("p1"), {
      wrapper: wrap({ onCustomerSessionExpired }),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(onCustomerSessionExpired).toHaveBeenCalledTimes(1);
    expect(tokenCalls).toBe(0);
  });

  it("delegates login and logout to proxySession, and refuses token-minting actions", async () => {
    const storage = createMemoryStorage();
    storage.setCartId("customer-cart");
    const login = vi.fn();
    const logout = vi.fn();
    const { result } = renderHook(() => ({ session: useCustomerSession(), confirm: useConfirmSignup() }), {
      wrapper: wrap({ storage, proxySession: { authenticated: true, login, logout } }),
    });

    await act(() => result.current.session.login({ email: "ignored", password: "ignored" }));
    expect(login).toHaveBeenCalledTimes(1);

    await act(() => result.current.session.logout());
    expect(logout).toHaveBeenCalledTimes(1);
    expect(storage.getCartId()).toBeNull();

    await expect(result.current.session.refreshSession()).rejects.toThrow(/customerSession "proxy"/);
    await expect(
      result.current.session.socialLogin({ code: "c", redirectUri: "https://x.test" }),
    ).rejects.toThrow(/customerSession "proxy"/);
    await expect(result.current.session.exchangeToken({ subjectToken: "t" })).rejects.toThrow(
      /customerSession "proxy"/,
    );
    await expect(result.current.confirm.mutateAsync("t")).rejects.toThrow(/customerSession "proxy"/);
    // None of them reached the proxy, let alone an Emporix auth endpoint.
    expect(seen.filter((s) => !s.path.endsWith("/me"))).toEqual([]);
    expect(tokenCalls).toBe(0);
  });

  it("rejects login and logout without proxySession callbacks", async () => {
    const { result } = renderHook(() => useCustomerSession(), { wrapper: wrap() });

    await expect(result.current.login({ email: "e", password: "p" })).rejects.toThrow(
      /needs proxySession\.login/,
    );
    await expect(result.current.logout()).rejects.toThrow(/needs proxySession\.logout/);
  });

  it("bootstraps no company context and refuses a switch", async () => {
    const { result } = renderHook(() => useActiveCompany(), {
      wrapper: wrap({ proxySession: { authenticated: true } }),
    });

    await expect(result.current.setActiveCompany("le-1")).rejects.toThrow(/customerSession is "proxy"/);
    expect(seen).toEqual([]);
  });

  it("refuses a mode that does not match the client", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const plain = new EmporixClient({ tenant: "acme", credentials: {}, logger: false });
    expect(() =>
      render(
        <EmporixProvider client={plain} customerSession="proxy">
          <span />
        </EmporixProvider>,
      ),
    ).toThrow(/needs a client built with `proxy`/);
    expect(() =>
      render(
        <EmporixProvider client={proxyClient()} customerSession="owned">
          <span />
        </EmporixProvider>,
      ),
    ).toThrow(/cannot be used with a proxy-mode client/);
    expect(() =>
      render(
        <EmporixProvider client={proxyClient()} initialCustomerToken="t">
          <span />
        </EmporixProvider>,
      ),
    ).toThrow(/initialCustomerToken cannot be used/);
    errorSpy.mockRestore();
  });
});
