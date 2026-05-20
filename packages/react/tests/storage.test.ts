import { describe, it, expect, beforeEach, vi } from "vitest";
import { createLocalStorageStorage } from "../src/storage/local-storage";
import { createCookieStorage } from "../src/storage/cookie";
import { createMemoryStorage } from "../src/storage/memory";

describe("localStorage storage", () => {
  beforeEach(() => localStorage.clear());

  it("persists and clears the token", () => {
    const s = createLocalStorageStorage();
    expect(s.getCustomerToken()).toBeNull();
    s.setCustomerToken("abc");
    expect(localStorage.getItem("emporix.customerToken")).toBe("abc");
    expect(createLocalStorageStorage().getCustomerToken()).toBe("abc");
    s.setCustomerToken(null);
    expect(localStorage.getItem("emporix.customerToken")).toBeNull();
  });

  it("uses a custom key", () => {
    createLocalStorageStorage({ key: "k" }).setCustomerToken("z");
    expect(localStorage.getItem("k")).toBe("z");
  });

  it("falls back to memory + warns once when localStorage is unavailable", () => {
    const orig = globalThis.localStorage;
    delete (globalThis as { localStorage?: unknown }).localStorage;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = createLocalStorageStorage();
    s.setCustomerToken("mem");
    expect(s.getCustomerToken()).toBe("mem");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    Object.defineProperty(globalThis, "localStorage", { value: orig, configurable: true });
  });
});

describe("cookie storage", () => {
  beforeEach(() => {
    document.cookie = "emporix.customerToken=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
  });

  it("reads and writes a cookie with attributes", () => {
    const s = createCookieStorage({ sameSite: "strict", secure: true });
    expect(s.getCustomerToken()).toBeNull();
    s.setCustomerToken("ck");
    expect(document.cookie).toContain("emporix.customerToken=ck");
    expect(s.getCustomerToken()).toBe("ck");
    s.setCustomerToken(null);
    expect(s.getCustomerToken()).toBeNull();
  });
});

describe("createCookieStorage — cartId + anonymous session", () => {
  beforeEach(() => {
    for (const c of document.cookie.split("; ")) {
      const [k] = c.split("=");
      document.cookie = `${k}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    }
  });

  it("round-trips cartId via cookie", () => {
    const s = createCookieStorage();
    expect(s.getCartId()).toBeNull();
    s.setCartId("cart-3");
    expect(s.getCartId()).toBe("cart-3");
    s.setCartId(null);
    expect(s.getCartId()).toBeNull();
  });

  it("round-trips anonymous session as JSON cookie", () => {
    const s = createCookieStorage();
    s.setAnonymousSession({ refreshToken: "rt", sessionId: "ss" });
    expect(s.getAnonymousSession()).toEqual({ refreshToken: "rt", sessionId: "ss" });
    s.setAnonymousSession(null);
    expect(s.getAnonymousSession()).toBeNull();
  });

  it("getAnonymousSession returns null on malformed JSON cookie", () => {
    document.cookie = "emporix.anonymousSession=not-json%7B; path=/";
    const s = createCookieStorage();
    expect(s.getAnonymousSession()).toBeNull();
  });
});

describe("createLocalStorageStorage — cartId + anonymous session", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips cartId via localStorage", () => {
    const s = createLocalStorageStorage();
    expect(s.getCartId()).toBeNull();
    s.setCartId("cart-2");
    expect(s.getCartId()).toBe("cart-2");
    expect(localStorage.getItem("emporix.cartId")).toBe("cart-2");
    s.setCartId(null);
    expect(localStorage.getItem("emporix.cartId")).toBeNull();
  });

  it("round-trips anonymous session as JSON", () => {
    const s = createLocalStorageStorage();
    s.setAnonymousSession({ refreshToken: "rt", sessionId: "ss" });
    const raw = localStorage.getItem("emporix.anonymousSession");
    expect(raw).toBe(JSON.stringify({ refreshToken: "rt", sessionId: "ss" }));
    expect(s.getAnonymousSession()).toEqual({ refreshToken: "rt", sessionId: "ss" });
    s.setAnonymousSession(null);
    expect(localStorage.getItem("emporix.anonymousSession")).toBeNull();
  });

  it("getAnonymousSession returns null on malformed JSON", () => {
    localStorage.setItem("emporix.anonymousSession", "not-json{");
    const s = createLocalStorageStorage();
    expect(s.getAnonymousSession()).toBeNull();
  });
});

describe("createMemoryStorage — cartId + anonymous session", () => {
  it("round-trips cartId", () => {
    const s = createMemoryStorage();
    expect(s.getCartId()).toBeNull();
    s.setCartId("cart-1");
    expect(s.getCartId()).toBe("cart-1");
    s.setCartId(null);
    expect(s.getCartId()).toBeNull();
  });

  it("round-trips anonymous session", () => {
    const s = createMemoryStorage();
    expect(s.getAnonymousSession()).toBeNull();
    s.setAnonymousSession({ refreshToken: "rt", sessionId: "ss" });
    expect(s.getAnonymousSession()).toEqual({ refreshToken: "rt", sessionId: "ss" });
    s.setAnonymousSession(null);
    expect(s.getAnonymousSession()).toBeNull();
  });
});
