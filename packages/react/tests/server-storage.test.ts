import { describe, it, expect, vi, afterEach } from "vitest";
import { auth } from "@viu/emporix-sdk";
import { createServerStorage, serverAuth } from "../src/storage/server";

/** A minimal in-object cookie jar, standing in for `await cookies()`. */
function jar(initial: Record<string, string> = {}) {
  const bag = new Map(Object.entries(initial));
  return {
    bag,
    get: (name: string) => bag.get(name) ?? null,
    set: (name: string, value: string | null) => {
      if (value === null) bag.delete(name);
      else bag.set(name, value);
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("createServerStorage", () => {
  it("reads all eight keys through the injected jar", () => {
    const j = jar({
      "emporix.customerToken": "cust",
      "emporix.cartId": "cart-1",
      "emporix.siteCode": "main",
      "emporix.language": "de",
      "emporix.activeLegalEntityId": "le-1",
      "emporix.refreshToken": "rt",
      "emporix.saasToken": "saas",
      "emporix.anonymousSession": JSON.stringify({ refreshToken: "art", sessionId: "sid" }),
    });
    const s = createServerStorage(j);

    expect(s.getCustomerToken()).toBe("cust");
    expect(s.getCartId()).toBe("cart-1");
    expect(s.getSiteCode()).toBe("main");
    expect(s.getLanguage()).toBe("de");
    expect(s.getActiveLegalEntityId()).toBe("le-1");
    expect(s.getRefreshToken()).toBe("rt");
    expect(s.getSaasToken?.()).toBe("saas");
    expect(s.getAnonymousSession()).toEqual({ refreshToken: "art", sessionId: "sid" });
  });

  it("returns null for absent keys and for a malformed anonymous session", () => {
    const s = createServerStorage(jar({ "emporix.anonymousSession": "not-json" }));
    expect(s.getCustomerToken()).toBeNull();
    expect(s.getCartId()).toBeNull();
    expect(s.getAnonymousSession()).toBeNull();
  });

  it("writes through the jar when a set accessor is supplied", () => {
    const j = jar();
    const s = createServerStorage(j);

    s.setCustomerToken("t1");
    s.setCartId("c1");
    s.setAnonymousSession({ refreshToken: "r", sessionId: "s" });
    expect(j.bag.get("emporix.customerToken")).toBe("t1");
    expect(j.bag.get("emporix.cartId")).toBe("c1");
    expect(JSON.parse(j.bag.get("emporix.anonymousSession") as string)).toEqual({
      refreshToken: "r",
      sessionId: "s",
    });

    s.setCustomerToken(null);
    expect(j.bag.has("emporix.customerToken")).toBe(false);
  });

  it("read-only when set is omitted: no throw, warns once per key", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const j = jar({ "emporix.customerToken": "cust" });
    const s = createServerStorage({ get: j.get });

    expect(() => s.setCustomerToken("new")).not.toThrow();
    s.setCustomerToken("again");
    s.setCartId("c1");

    // Reads still work.
    expect(s.getCustomerToken()).toBe("cust");
    // Two distinct keys warned about, and customerToken only once.
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("customerToken"))).toHaveLength(1);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("cartId"))).toHaveLength(1);
  });

  it("omits subscribe and subscribeAll — a server render has no lifetime to observe", () => {
    const s = createServerStorage(jar());
    expect(s.subscribe).toBeUndefined();
    expect(s.subscribeAll).toBeUndefined();
  });
});

describe("serverAuth", () => {
  it("resolves a customer context when a token is stored", () => {
    const s = createServerStorage(jar({ "emporix.customerToken": "cust" }));
    expect(serverAuth(s)).toEqual(auth.customer("cust"));
  });

  it("resolves an anonymous context when no token is stored", () => {
    const s = createServerStorage(jar());
    expect(serverAuth(s)).toEqual(auth.anonymous());
  });
});
