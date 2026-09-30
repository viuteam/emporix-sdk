import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmporixNotFoundError, type EmporixClient } from "@viu/emporix-sdk";
import type { EmporixSessionHandle } from "@viu/emporix-sdk-next/session";
import { applyCoupon, removeLine } from "../app/actions/cart";

// The real session entry is server-only and throws outside Next's server graph, so the
// actions get a session made of a Map and a client made of stubs.
const s = vi.hoisted(() => ({
  store: new Map<string, string>(),
  carts: {} as Record<string, () => Promise<unknown>>,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("../app/lib/site-context", () => ({ emporixOptions: async () => ({}) }));
vi.mock("@viu/emporix-sdk-next/session", () => ({
  STORAGE_KEYS: { cartId: "emporix.cartId" },
  SESSION_MAX_AGE: { cartId: 60 },
  withEmporixSessionMutable: (
    fn: (client: EmporixClient, ctx: unknown, handle: EmporixSessionHandle) => Promise<unknown>,
  ) =>
    fn({ carts: s.carts } as unknown as EmporixClient, { kind: "anonymous" }, {
      get: (k) => s.store.get(k) ?? null,
      set: (k, v) => void s.store.set(k, v),
      delete: (k) => void s.store.delete(k),
      flush: async () => undefined,
      destroy: async () => undefined,
    }),
}));

const notFound = (message: string): EmporixNotFoundError =>
  new EmporixNotFoundError("Not Found", 404, { code: 404, status: "Not Found", message });

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

beforeEach(() => {
  s.store.clear();
  s.store.set("emporix.cartId", "my-cart");
  s.store.set("demo.cartCount", "2");
});

/**
 * Emporix answers a line that is already gone and a coupon code it does not know with
 * the same 404 as a cart a checkout closed — measured on `viu` 2026-09-30. The session
 * used to drop the cart on all three.
 */
describe("a cart write that answers 404", () => {
  it("keeps the cart when only the line is gone", async () => {
    // Another tab removed the line first. The cart read says the cart is fine, and
    // its one remaining line is what the badge shows now.
    const get = vi.fn(async () => ({ id: "my-cart", items: [{ id: "1" }] }));
    s.carts = {
      removeItem: async () => {
        throw notFound("Cart item not found in cart my-cart with code 9");
      },
      get,
    };

    const state = await removeLine({ error: null }, form({ itemId: "9" }));

    expect(state.error).toContain("Cart item not found");
    expect(s.store.get("emporix.cartId")).toBe("my-cart");
    expect(s.store.get("demo.cartCount")).toBe("1");
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("keeps the cart when the coupon code is unknown", async () => {
    // The likelier way in: a mistyped code.
    s.carts = {
      applyCoupon: async () => {
        throw notFound("Coupon with code NOPE not found.");
      },
      get: async () => ({ id: "my-cart", items: [{ id: "1" }, { id: "2" }] }),
    };

    const state = await applyCoupon({ error: null }, form({ code: "NOPE" }));

    expect(state.error).toContain("Coupon with code NOPE not found.");
    expect(s.store.get("emporix.cartId")).toBe("my-cart");
  });

  it("drops the cart when the cart read 404s too", async () => {
    // Closed by a checkout on another device. `GET /carts/{id}` names nothing but the
    // cart, so its 404 is the one that settles it.
    s.carts = {
      removeItem: async () => {
        throw notFound("Cart with code my-cart not found.");
      },
      get: async () => {
        throw notFound("Cart with code my-cart not found.");
      },
    };

    await removeLine({ error: null }, form({ itemId: "9" }));

    expect(s.store.has("emporix.cartId")).toBe(false);
    expect(s.store.has("demo.cartCount")).toBe(false);
  });
});
