import { beforeEach, describe, expect, it, vi } from "vitest";
import { TestBed } from "@angular/core/testing";
import { QueryClient } from "@tanstack/angular-query-experimental";
import { auth, createMemoryStorage, type EmporixStorage } from "@viu/emporix-sdk";
import { provideEmporix } from "../src/provide";
import { injectCustomerCredentials } from "../src/customer-credentials";
import { injectCustomerSession } from "../src/customer-session";

function setup() {
  const storage = createMemoryStorage();
  const queryClient = new QueryClient();
  const calls = {
    changePassword: vi.fn(async () => undefined),
    changeEmail: vi.fn(async () => undefined),
    confirmEmailChange: vi.fn(async () => undefined),
    resendActivation: vi.fn(async () => undefined),
    confirmSignup: vi.fn(async () => ({
      customerToken: "t-confirmed",
      refreshToken: "r1",
      saasToken: "s1",
    })),
    me: vi.fn(async () => ({ id: "c1", contactEmail: "a@b.ch" })),
    getCurrent: vi.fn(async () => ({ id: "cart-customer" })),
    merge: vi.fn(async () => undefined),
  };
  const client = {
    tenant: "acme",
    config: { credentials: { storefront: { context: { siteCode: "main" } } } },
    sites: { get: async () => ({ currency: "CHF" }) },
    sessionContext: { patch: async () => true },
    setStorefrontContext: vi.fn(),
    customers: {
      changePassword: calls.changePassword,
      changeEmail: calls.changeEmail,
      confirmEmailChange: calls.confirmEmailChange,
      resendActivation: calls.resendActivation,
      confirmSignup: calls.confirmSignup,
      me: calls.me,
      login: vi.fn(),
      logout: vi.fn(),
      signup: vi.fn(),
      refresh: vi.fn(),
    },
    carts: { getCurrent: calls.getCurrent, merge: calls.merge },
  } as never;
  TestBed.configureTestingModule({
    providers: [provideEmporix({ client, storage, queryClient })],
  });
  return { storage, queryClient, calls };
}

describe("injectCustomerCredentials — the customer-only half", () => {
  let ctx: ReturnType<typeof setup>;

  beforeEach(() => {
    ctx = setup();
  });

  it("changePassword sends the stored customer token", async () => {
    ctx.storage.setCustomerToken("t1");
    const creds = TestBed.runInInjectionContext(() => injectCustomerCredentials());
    await creds.changePassword({ currentPassword: "old", newPassword: "new" });
    expect(ctx.calls.changePassword).toHaveBeenCalledWith(
      { currentPassword: "old", newPassword: "new" },
      auth.customer("t1"),
    );
  });

  it("changePassword refuses without a session, and says which operation", async () => {
    const creds = TestBed.runInInjectionContext(() => injectCustomerCredentials());
    await expect(
      creds.changePassword({ currentPassword: "old", newPassword: "new" }),
    ).rejects.toThrow(/changePassword requires a signed-in customer/);
    // Nothing was sent — the guard is local, so no request is spent on a call
    // the SDK would reject at its own boundary anyway.
    expect(ctx.calls.changePassword).not.toHaveBeenCalled();
  });

  it("changeEmail sends the customer token and refetches the profile", async () => {
    ctx.storage.setCustomerToken("t1");
    const spy = vi.spyOn(ctx.queryClient, "invalidateQueries");
    const creds = TestBed.runInInjectionContext(() => injectCustomerCredentials());
    await creds.changeEmail({ email: "a@b.ch", password: "pw", newEmail: "c@d.ch" });
    expect(ctx.calls.changeEmail).toHaveBeenCalledWith(expect.anything(), auth.customer("t1"));
    expect(spy).toHaveBeenCalledWith({ queryKey: ["emporix", "customer-me"] });
  });

  it("never writes a credential into storage", async () => {
    ctx.storage.setCustomerToken("t1");
    const creds = TestBed.runInInjectionContext(() => injectCustomerCredentials());
    await creds.changePassword({ currentPassword: "hunter2", newPassword: "hunter3" });
    const persisted = [
      ctx.storage.getCustomerToken(),
      ctx.storage.getRefreshToken(),
      ctx.storage.getSaasToken?.() ?? null,
    ].filter((v): v is string => v !== null);
    expect(persisted.some((v) => v.includes("hunter"))).toBe(false);
  });
});

describe("injectCustomerCredentials — the anonymous half", () => {
  let ctx: ReturnType<typeof setup>;

  beforeEach(() => {
    ctx = setup();
  });

  /**
   * The load-bearing distinction. A visitor following a confirmation link has no
   * session, so gating these on a customer token would make the link unusable —
   * which is the failure mode a naive "everything customer-scoped" port produces.
   */
  it("confirmEmailChange works with no session at all", async () => {
    const creds = TestBed.runInInjectionContext(() => injectCustomerCredentials());
    await creds.confirmEmailChange({ token: "email-token" });
    expect(ctx.calls.confirmEmailChange).toHaveBeenCalledWith(
      { token: "email-token" },
      auth.anonymous(),
    );
  });

  it("resendActivation works with no session at all", async () => {
    const creds = TestBed.runInInjectionContext(() => injectCustomerCredentials());
    await creds.resendActivation({ email: "a@b.ch" });
    expect(ctx.calls.resendActivation).toHaveBeenCalledWith(
      { email: "a@b.ch" },
      auth.anonymous(),
    );
  });

  it("stays anonymous even when a customer token happens to be stored", async () => {
    // The token is irrelevant to these two: the emailed token is the credential.
    ctx.storage.setCustomerToken("t1");
    const creds = TestBed.runInInjectionContext(() => injectCustomerCredentials());
    await creds.resendActivation({ email: "a@b.ch" });
    expect(ctx.calls.resendActivation).toHaveBeenCalledWith(
      { email: "a@b.ch" },
      auth.anonymous(),
    );
  });
});

describe("confirmSignup establishes a session", () => {
  it("signs the customer in rather than handing back an unusable session", async () => {
    const ctx = setup();
    const session = TestBed.runInInjectionContext(() => injectCustomerSession());
    expect(session.isAuthenticated()).toBe(false);

    await session.confirmSignup("signup-token");

    // Anonymous on the wire — there is no session to send yet.
    expect(ctx.calls.confirmSignup).toHaveBeenCalledWith("signup-token", auth.anonymous());
    // …and the returned session is applied, which is the whole divergence from
    // React's useConfirmSignup: it returns a session the caller cannot install.
    expect(session.isAuthenticated()).toBe(true);
    expect(ctx.storage.getCustomerToken()).toBe("t-confirmed");
    expect(ctx.storage.getSaasToken?.()).toBe("s1");
  });

  it("runs the same cart onboarding as login", async () => {
    const ctx = setup();
    ctx.storage.setCartId("cart-guest");
    const session = TestBed.runInInjectionContext(() => injectCustomerSession());
    await session.confirmSignup("signup-token");
    // A visitor who filled a basket before confirming must not lose it.
    expect(ctx.calls.merge).toHaveBeenCalledWith(
      "cart-customer",
      ["cart-guest"],
      expect.anything(),
    );
  });
});

describe("shared pending and error state", () => {
  it("surfaces a failure and clears isPending", async () => {
    const ctx = setup();
    ctx.storage.setCustomerToken("t1");
    ctx.calls.changeEmail.mockRejectedValueOnce(new Error("409 email taken"));
    const creds = TestBed.runInInjectionContext(() => injectCustomerCredentials());
    await expect(creds.changeEmail({ newEmail: "c@d.ch" })).rejects.toThrow("409 email taken");
    expect(creds.error()?.message).toBe("409 email taken");
    expect(creds.isPending()).toBe(false);
  });

  it("clears the previous error when the next call starts", async () => {
    const ctx = setup();
    ctx.storage.setCustomerToken("t1");
    ctx.calls.changeEmail.mockRejectedValueOnce(new Error("boom"));
    const creds = TestBed.runInInjectionContext(() => injectCustomerCredentials());
    await creds.changeEmail({ newEmail: "c@d.ch" }).catch(() => {});
    expect(creds.error()).not.toBeNull();
    await creds.resendActivation({ email: "a@b.ch" });
    expect(creds.error()).toBeNull();
  });
});

/** Guards a storage that omits the optional saas-token accessors. */
describe("a storage without setSaasToken", () => {
  it("does not break confirmSignup", async () => {
    const bare = { ...createMemoryStorage() } as EmporixStorage & { setSaasToken?: unknown };
    delete bare.setSaasToken;
    delete (bare as { getSaasToken?: unknown }).getSaasToken;
    const client = {
      tenant: "acme",
      config: { credentials: { storefront: { context: {} } } },
      sites: { get: async () => ({}) },
      sessionContext: { patch: async () => true },
      setStorefrontContext: vi.fn(),
      customers: {
        confirmSignup: async () => ({ customerToken: "t9", refreshToken: "r9", saasToken: "s9" }),
        me: async () => ({ id: "c1" }),
        login: vi.fn(),
        logout: vi.fn(),
        signup: vi.fn(),
        refresh: vi.fn(),
      },
      carts: { getCurrent: async () => null, merge: vi.fn() },
    } as never;
    TestBed.configureTestingModule({
      providers: [provideEmporix({ client, storage: bare, queryClient: new QueryClient() })],
    });
    const session = TestBed.runInInjectionContext(() => injectCustomerSession());
    await session.confirmSignup("token");
    expect(session.isAuthenticated()).toBe(true);
  });
});
