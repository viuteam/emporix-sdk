import { describe, expect, it, vi } from "vitest";
import { TestBed } from "@angular/core/testing";
import { QueryClient } from "@tanstack/angular-query-experimental";
import { createMemoryStorage } from "@viu/emporix-sdk";
import { provideEmporix } from "../src/provide";
import { injectCustomerSession } from "../src/customer-session";

function setup(
  overrides: {
    login?: () => Promise<unknown>;
    me?: () => Promise<unknown>;
    getCurrent?: () => Promise<unknown>;
    siteCode?: string;
  } = {},
) {
  const storage = createMemoryStorage();
  const queryClient = new QueryClient();
  const login = vi.fn(
    overrides.login ??
      (async () => ({ customerToken: "t1", refreshToken: "r1", saasToken: "s1" })),
  );
  const logout = vi.fn(async () => undefined);
  const signup = vi.fn(async () => undefined);
  const refresh = vi.fn(async () => ({ customerToken: "t2", refreshToken: "r2" }));
  const me = vi.fn(overrides.me ?? (async () => ({ id: "c1", email: "a@b.ch" })));
  const getCurrent = vi.fn(overrides.getCurrent ?? (async () => ({ id: "cart-customer" })));
  const merge = vi.fn(async () => undefined);
  const client = {
    tenant: "acme",
    config: {
      credentials: {
        storefront: { context: { siteCode: overrides.siteCode ?? "main" } },
      },
    },
    sites: { get: async () => ({ currency: "CHF" }) },
    sessionContext: { patch: async () => true },
    setStorefrontContext: vi.fn(),
    customers: { login, logout, signup, refresh, me },
    carts: { getCurrent, merge },
  } as never;
  TestBed.configureTestingModule({
    providers: [provideEmporix({ client, storage, queryClient })],
  });
  const session = TestBed.runInInjectionContext(() => injectCustomerSession());
  return { session, storage, queryClient, login, logout, signup, refresh, me, getCurrent, merge };
}

describe("injectCustomerSession", () => {
  it("starts unauthenticated with an empty storage", () => {
    const { session } = setup();
    expect(session.token()).toBeNull();
    expect(session.isAuthenticated()).toBe(false);
  });

  it("stores all three tokens on login and flips isAuthenticated", async () => {
    const { session, storage } = setup();
    await session.login({ email: "a@b.ch", password: "pw" });
    expect(storage.getCustomerToken()).toBe("t1");
    expect(storage.getRefreshToken()).toBe("r1");
    expect(storage.getSaasToken?.()).toBe("s1");
    expect(session.isAuthenticated()).toBe(true);
    expect(session.saasToken()).toBe("s1");
  });

  it("drops the now-dormant anonymous session on login", async () => {
    const { session, storage } = setup();
    storage.setAnonymousSession({ refreshToken: "ar", sessionId: "as" });
    await session.login({ email: "a@b.ch", password: "pw" });
    // The auth layer always prefers the customer token, so a kept guest session
    // would linger unused.
    expect(storage.getAnonymousSession()).toBeNull();
  });

  it("merges a guest cart into the customer cart on login", async () => {
    const { session, storage, merge } = setup();
    storage.setCartId("cart-guest");
    await session.login({ email: "a@b.ch", password: "pw" });
    // Path id is the CUSTOMER cart (the target); the body lists the anonymous
    // carts. Inverting this loses the basket, so the order is asserted.
    expect(merge).toHaveBeenCalledWith("cart-customer", ["cart-guest"], expect.anything());
    expect(storage.getCartId()).toBe("cart-customer");
  });

  it("does not merge when there was no guest cart", async () => {
    const { session, storage, merge } = setup();
    await session.login({ email: "a@b.ch", password: "pw" });
    expect(merge).not.toHaveBeenCalled();
    expect(storage.getCartId()).toBe("cart-customer");
  });

  it("still completes the login when cart onboarding fails", async () => {
    const { session, storage } = setup({
      getCurrent: () => Promise.reject(new Error("cart 500")),
    });
    await session.login({ email: "a@b.ch", password: "pw" });
    // Best-effort: a cart failure must not cost the customer their session.
    expect(session.isAuthenticated()).toBe(true);
    expect(storage.getCustomerToken()).toBe("t1");
    expect(session.error()).toBeNull();
  });

  it("clears everything on logout and purges the cache", async () => {
    const { session, storage, queryClient } = setup();
    await session.login({ email: "a@b.ch", password: "pw" });
    const spy = vi.spyOn(queryClient, "removeQueries");
    await session.logout();
    expect(storage.getCustomerToken()).toBeNull();
    expect(storage.getRefreshToken()).toBeNull();
    expect(storage.getCartId()).toBeNull();
    expect(session.isAuthenticated()).toBe(false);
    // removeQueries, not invalidateQueries: customer-scoped entries are keyed by
    // authKind with no user id, so a later login as a different customer would
    // otherwise be served the previous customer's data from cache.
    expect(spy).toHaveBeenCalledWith({ queryKey: ["emporix"] });
  });

  it("clears the local session even when the server logout fails", async () => {
    const { session, storage, logout } = setup();
    await session.login({ email: "a@b.ch", password: "pw" });
    logout.mockRejectedValueOnce(new Error("401"));
    await session.logout();
    expect(storage.getCustomerToken()).toBeNull();
    expect(session.error()).toBeNull();
  });

  it("surfaces a login failure in error and stays unauthenticated", async () => {
    const { session, login } = setup();
    login.mockRejectedValueOnce(new Error("401"));
    await expect(session.login({ email: "a@b.ch", password: "wrong" })).rejects.toThrow("401");
    expect(session.error()?.message).toBe("401");
    expect(session.isAuthenticated()).toBe(false);
    expect(session.isPending()).toBe(false);
  });

  it("refreshSession swaps the token and keeps the old saas token", async () => {
    const { session, storage } = setup();
    await session.login({ email: "a@b.ch", password: "pw" });
    await session.refreshSession();
    expect(storage.getCustomerToken()).toBe("t2");
    expect(storage.getRefreshToken()).toBe("r2");
    // The refresh endpoint returned no saasToken, so the existing one stands —
    // it cannot be re-minted, and customer checkout needs it.
    expect(session.saasToken()).toBe("s1");
  });

  it("refreshSession is a no-op without a refresh token", async () => {
    const { session, refresh } = setup();
    await session.refreshSession();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("never writes a credential into storage", async () => {
    const { session, storage } = setup();
    await session.login({ email: "a@b.ch", password: "hunter2" });
    // A password must not reach any persisted key, whatever the flow does
    // internally.
    const persisted = [
      storage.getCustomerToken(),
      storage.getRefreshToken(),
      storage.getSaasToken?.() ?? null,
      storage.getCartId(),
      storage.getSiteCode(),
      storage.getLanguage(),
    ].filter((v): v is string => v !== null);
    expect(persisted.some((v) => v.includes("hunter2"))).toBe(false);
  });
});

describe("preferred site", () => {
  it("switches to the customer's preferredSite when it differs", async () => {
    const { session, storage } = setup({
      me: async () => ({ id: "c1", preferredSite: "other" }),
    });
    await session.login({ email: "a@b.ch", password: "pw" });
    expect(storage.getSiteCode()).toBe("other");
  });

  it("leaves the site alone when the preference matches", async () => {
    const { session, storage } = setup({
      me: async () => ({ id: "c1", preferredSite: "main" }),
    });
    await session.login({ email: "a@b.ch", password: "pw" });
    expect(storage.getSiteCode()).toBeNull();
  });
});
