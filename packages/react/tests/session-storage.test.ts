import { describe, it, expect, beforeEach, vi } from "vitest";
import { createSessionStorage } from "../src/storage/session-storage";

describe("sessionStorage storage", () => {
  beforeEach(() => sessionStorage.clear());

  it("persists and clears the token", () => {
    const s = createSessionStorage();
    expect(s.getCustomerToken()).toBeNull();
    s.setCustomerToken("abc");
    expect(sessionStorage.getItem("emporix.customerToken")).toBe("abc");
    expect(createSessionStorage().getCustomerToken()).toBe("abc");
    s.setCustomerToken(null);
    expect(sessionStorage.getItem("emporix.customerToken")).toBeNull();
  });

  it("uses a custom key", () => {
    createSessionStorage({ key: "k" }).setCustomerToken("z");
    expect(sessionStorage.getItem("k")).toBe("z");
  });

  it("round-trips cartId, anonymousSession, siteCode, language, saasToken", () => {
    const s = createSessionStorage();
    s.setCartId("cart-9");
    expect(sessionStorage.getItem("emporix.cartId")).toBe("cart-9");
    s.setAnonymousSession({ refreshToken: "rt", sessionId: "ss" });
    expect(s.getAnonymousSession()).toEqual({ refreshToken: "rt", sessionId: "ss" });
    s.setSiteCode("main");
    expect(s.getSiteCode()).toBe("main");
    s.setLanguage("de");
    expect(s.getLanguage()).toBe("de");
    s.setSaasToken?.("saas-9");
    expect(s.getSaasToken?.()).toBe("saas-9");
  });

  it("getAnonymousSession returns null on malformed JSON", () => {
    sessionStorage.setItem("emporix.anonymousSession", "not-json{");
    expect(createSessionStorage().getAnonymousSession()).toBeNull();
  });

  it("is isolated from localStorage (per-tab privacy)", () => {
    localStorage.clear();
    createSessionStorage().setCustomerToken("only-session");
    expect(sessionStorage.getItem("emporix.customerToken")).toBe("only-session");
    expect(localStorage.getItem("emporix.customerToken")).toBeNull();
  });

  it("notifies subscribe + subscribeAll on writes", () => {
    const s = createSessionStorage();
    const tokens: (string | null)[] = [];
    const keys: string[] = [];
    s.subscribe!((t) => tokens.push(t));
    s.subscribeAll!((k) => keys.push(k));
    s.setCustomerToken("t");
    s.setCartId("c");
    expect(tokens).toEqual(["t"]);
    expect(keys).toEqual(["customerToken", "cartId"]);
  });

  it("falls back to memory + warns once when sessionStorage is unavailable", () => {
    const orig = globalThis.sessionStorage;
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = createSessionStorage();
    s.setCustomerToken("mem");
    expect(s.getCustomerToken()).toBe("mem");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    Object.defineProperty(globalThis, "sessionStorage", { value: orig, configurable: true });
  });
});
