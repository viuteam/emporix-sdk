import { describe, expect, it, beforeEach, vi } from "vitest";
import { NextResponse } from "next/server";
import type { EmporixSessionStore } from "../src/session-store";

/**
 * Next's real `ResponseCookies` this time, not a Map.
 *
 * The other suites fake `cookies()` with a Map whose `delete(name)` always
 * succeeds. That is how a deletion the browser rejects passed every test: over
 * HTTPS the names carry the `__Host-` prefix, and a browser accepts a `__Host-`
 * `Set-Cookie` only with `Secure` and `Path=/` — the deleting one included.
 * Next's `delete(name)` writes `Path=/` and an expired date, but no `Secure`.
 * Only the emitted header shows that.
 */
let response = NextResponse.next();
const headerBag = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve(response.cookies),
  headers: () => Promise.resolve({ get: (k: string) => headerBag.get(k) ?? null }),
}));

const { emporixSessionHandle } = await import("../src/session-cookies");
const { emporixSessionMutable } = await import("../src/session");
const { SESSION_SID } = await import("../src/session-store");

/** The `Set-Cookie` line the response carries for one cookie name. */
function setCookie(name: string): string | undefined {
  return response.headers.getSetCookie().find((line) => line.startsWith(`${name}=`));
}

/** A deleting line: empty value, expired, and the attributes a `__Host-` cookie needs. */
function expectHostDeletion(name: string): void {
  const line = setCookie(name);
  expect(line).toBeDefined();
  expect(line?.startsWith(`${name}=;`)).toBe(true); // an empty value
  expect(line).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  expect(line).toContain("Path=/");
  expect(line).toContain("Secure");
}

function fakeStore(): EmporixSessionStore {
  const records = new Map<string, Record<string, string>>();
  return {
    read: async (id) => records.get(id) ?? null,
    write: async (id, record) => {
      records.set(id, { ...record });
    },
    destroy: async (id) => {
      records.delete(id);
    },
  };
}

beforeEach(() => {
  response = NextResponse.next();
  headerBag.clear();
  headerBag.set("x-forwarded-proto", "https");
});

describe("deleting a __Host- cookie over HTTPS", () => {
  it("handle.delete in cookie mode sends Secure and Path=/", async () => {
    const handle = await emporixSessionHandle();
    handle.set("emporix.cartId", "cart-1", 3600);
    handle.delete("emporix.cartId");
    expectHostDeletion("__Host-emporix.cartId");
  });

  it("handle.delete of a public key in store mode sends Secure and Path=/", async () => {
    const handle = await emporixSessionHandle({ store: fakeStore() });
    handle.set("emporix.siteCode", "main", 3600);
    handle.delete("emporix.siteCode");
    expectHostDeletion("__Host-emporix.siteCode");
  });

  it("destroy() deletes the sid cookie with Secure and Path=/", async () => {
    const store = fakeStore();
    const first = await emporixSessionHandle({ store });
    first.set("emporix.cartId", "cart-1", 3600);
    await first.flush();
    // The sid the flush just wrote is what the next handle reads back.
    expect(setCookie(`__Host-${SESSION_SID}`)).toBeDefined();

    const second = await emporixSessionHandle({ store });
    await second.destroy();
    expectHostDeletion(`__Host-${SESSION_SID}`);
  });

  it("emporixSessionMutable deletes on a null write with Secure and Path=/", async () => {
    const session = await emporixSessionMutable();
    session.storage.setCartId("cart-1");
    session.storage.setCartId(null);
    expectHostDeletion("__Host-emporix.cartId");
  });

  it("stays unprefixed and without Secure over plain http", async () => {
    headerBag.set("x-forwarded-proto", "http");
    const handle = await emporixSessionHandle();
    handle.set("emporix.cartId", "cart-1", 3600);
    handle.delete("emporix.cartId");
    const line = setCookie("emporix.cartId");
    expect(line).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    expect(line).not.toContain("Secure");
    expect(setCookie("__Host-emporix.cartId")).toBeUndefined();
  });
});
