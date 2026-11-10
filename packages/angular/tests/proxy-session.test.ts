import { describe, expect, it, vi } from "vitest";
import { TestBed } from "@angular/core/testing";
import { QueryClient } from "@tanstack/angular-query-experimental";
import {
  EmporixClient,
  PROXY_CUSTOMER_TOKEN,
  createMemoryStorage,
  type EmporixStorage,
} from "@viu/emporix-sdk";
import { provideEmporix } from "../src/provide";
import { injectCustomerSession } from "../src/customer-session";
import { injectCompanySwitch } from "../src/company-switch";
import type { EmporixProxySession } from "../src/tokens";

/** A fetch double: records what reached the "proxy" and answers 200 with a customer. */
function recordingFetch() {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const impl: typeof globalThis.fetch = async (input, init) => {
    calls.push({
      url: String(input),
      headers: Object.fromEntries(
        Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
      ),
    });
    return new Response(JSON.stringify({ id: "c1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, impl };
}

function setup(proxySession: EmporixProxySession = {}) {
  const { calls, impl } = recordingFetch();
  const client = new EmporixClient({
    tenant: "acme",
    host: "/emporix",
    credentials: {},
    logger: false,
    fetch: impl,
    proxy: { headers: { "X-CSRF": "1" } },
  });
  const storage: EmporixStorage = createMemoryStorage();
  TestBed.configureTestingModule({
    providers: [
      provideEmporix({ client, storage, queryClient: new QueryClient(), proxySession }),
    ],
  });
  const session = TestBed.runInInjectionContext(() => injectCustomerSession());
  return { session, storage, calls };
}

describe("provideEmporix in proxy mode", () => {
  it("takes the customer path on the marker while the base storage holds no token", async () => {
    const { session, storage, calls } = setup({ authenticated: true });

    expect(session.token()).toBe(PROXY_CUSTOMER_TOKEN);
    expect(session.isAuthenticated()).toBe(true);
    await vi.waitFor(() => expect(session.customer()).not.toBeNull());
    expect(calls.map((c) => c.url)).toEqual([`${location.origin}/emporix/customer/acme/me`]);
    expect(calls[0]!.headers["authorization"]).toBeUndefined();
    expect(calls[0]!.headers["x-csrf"]).toBe("1");
    expect(storage.getCustomerToken()).toBeNull();
  });

  it("is a guest without proxySession.authenticated", () => {
    const { session } = setup();

    expect(session.token()).toBeNull();
    expect(session.isAuthenticated()).toBe(false);
  });

  it("delegates login and logout, and refuses actions that would mint a token", async () => {
    const login = vi.fn();
    const logout = vi.fn();
    const { session, storage, calls } = setup({ authenticated: true, login, logout });
    storage.setCartId("customer-cart");

    await session.login({ email: "ignored", password: "ignored" });
    await session.logout();
    expect(login).toHaveBeenCalledTimes(1);
    expect(logout).toHaveBeenCalledTimes(1);
    expect(storage.getCartId()).toBeNull();

    await expect(session.confirmSignup("t")).rejects.toThrow(/proxy mode/);
    await expect(session.refreshSession()).rejects.toThrow(/proxy mode/);
    expect(calls.filter((c) => !c.url.endsWith("/me"))).toEqual([]);
  });

  it("rejects login and logout without callbacks", async () => {
    const { session } = setup();

    await expect(session.login({ email: "e", password: "p" })).rejects.toThrow(/needs proxySession\.login/);
    await expect(session.logout()).rejects.toThrow(/needs proxySession\.logout/);
  });

  it("bootstraps no company context and reports a switch as unavailable", async () => {
    const { calls } = setup({ authenticated: true });
    const switcher = TestBed.runInInjectionContext(() => injectCompanySwitch());

    await switcher.setActiveCompany(null);

    expect(String(switcher.switchError())).toMatch(/proxy mode/);
    expect(calls.some((c) => c.url.includes("legal-entities"))).toBe(false);
  });

  it("refuses proxySession with a client that is not in proxy mode", () => {
    const client = new EmporixClient({ tenant: "acme", credentials: {}, logger: false });
    expect(() => provideEmporix({ client, proxySession: {} })).toThrow(/needs a client built with `proxy`/);
  });
});
