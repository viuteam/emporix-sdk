import { describe, it, expect, vi, beforeEach } from "vitest";
import { auth } from "@viu/emporix-sdk";

/** Next's `cookies()` shape, enough of it to drive the code under test. */
interface FakeCookie {
  name: string;
  value: string;
  opts?: Record<string, unknown>;
}
const bag = new Map<string, FakeCookie>();
const jar = {
  get: (name: string): FakeCookie | undefined => bag.get(name),
  set: (name: string, value: string, opts?: Record<string, unknown>): void => {
    bag.set(name, { name, value, ...(opts ? { opts } : {}) });
  },
  delete: (name: string): void => {
    bag.delete(name);
  },
};

vi.mock("next/headers", () => ({ cookies: () => Promise.resolve(jar) }));

// Imported after the mock is registered.
const { emporixSession, emporixSessionMutable } = await import("../src/session");

beforeEach(() => bag.clear());

describe("emporixSession (read-only)", () => {
  it("reads the whole session out of the cookie jar", async () => {
    jar.set("emporix.customerToken", "cust");
    jar.set("emporix.cartId", "cart-1");
    jar.set("emporix.siteCode", "main");
    jar.set("emporix.language", "de");
    jar.set("emporix.activeLegalEntityId", "le-1");

    const s = await emporixSession();

    expect(s.customerToken).toBe("cust");
    expect(s.cartId).toBe("cart-1");
    expect(s.siteCode).toBe("main");
    expect(s.language).toBe("de");
    expect(s.legalEntityId).toBe("le-1");
    expect(s.auth).toEqual(auth.customer("cust"));
  });

  it("resolves an anonymous context and null fields on an empty jar", async () => {
    const s = await emporixSession();
    expect(s.customerToken).toBeNull();
    expect(s.cartId).toBeNull();
    expect(s.siteCode).toBeNull();
    expect(s.language).toBeNull();
    expect(s.legalEntityId).toBeNull();
    expect(s.auth).toEqual(auth.anonymous());
  });

  it("is read-only: a write warns and does not touch the jar", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = await emporixSession();

    expect(() => s.storage.setCustomerToken("new")).not.toThrow();

    expect(bag.has("emporix.customerToken")).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("emporixSessionMutable", () => {
  it("writes through with secure httpOnly defaults", async () => {
    const s = await emporixSessionMutable();

    s.storage.setCustomerToken("t1");

    // secure defaults to true here, so the name carries the __Host- prefix.
    const written = bag.get("__Host-emporix.customerToken");
    expect(written?.value).toBe("t1");
    expect(written?.opts).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
    });
  });

  it("honours overrides", async () => {
    const s = await emporixSessionMutable({
      sameSite: "strict",
      secure: false,
      httpOnly: false,
    });

    s.storage.setCartId("c1");

    expect(bag.get("emporix.cartId")?.opts).toMatchObject({
      httpOnly: false,
      sameSite: "strict",
      secure: false,
    });
  });

  it("deletes the cookie on a null write", async () => {
    jar.set("__Host-emporix.cartId", "c1");
    const s = await emporixSessionMutable();

    s.storage.setCartId(null);

    expect(bag.has("__Host-emporix.cartId")).toBe(false);
  });

  it("round-trips every key the session exposes", async () => {
    const s = await emporixSessionMutable();

    s.storage.setCustomerToken("t");
    s.storage.setCartId("c");
    s.storage.setSiteCode("main");
    s.storage.setLanguage("fr");
    s.storage.setActiveLegalEntityId("le");

    const again = await emporixSessionMutable();
    expect(again.customerToken).toBe("t");
    expect(again.cartId).toBe("c");
    expect(again.siteCode).toBe("main");
    expect(again.language).toBe("fr");
    expect(again.legalEntityId).toBe("le");
  });
});
