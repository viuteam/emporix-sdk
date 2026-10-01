import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmporixNotFoundError, type EmporixClient } from "@viu/emporix-sdk";
import type { EmporixSessionHandle } from "@viu/emporix-sdk-next/session";
import { addToCart, applyCoupon, removeCoupon, removeLine, setQuantity } from "../app/actions/cart";

// The real session entry is server-only and throws outside Next's server graph, so the
// actions get a session made of a Map and a client made of stubs.
const s = vi.hoisted(() => ({
  store: new Map<string, string>(),
  client: {} as Record<string, unknown>,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("../app/lib/site-context", () => ({ emporixOptions: async () => ({}) }));
vi.mock("@viu/emporix-sdk-next/session", () => ({
  STORAGE_KEYS: { cartId: "emporix.cartId" },
  SESSION_MAX_AGE: { cartId: 60 },
  withEmporixSessionMutable: (
    fn: (client: EmporixClient, ctx: unknown, handle: EmporixSessionHandle) => Promise<unknown>,
  ) =>
    fn(s.client as unknown as EmporixClient, { kind: "anonymous" }, {
      get: (k) => s.store.get(k) ?? null,
      set: (k, v) => void s.store.set(k, v),
      delete: (k) => void s.store.delete(k),
      flush: async () => undefined,
      destroy: async () => undefined,
    }),
}));

const ANON = { kind: "anonymous" };
const GET_CART = { type: "GetCart" };

const notFound = (message: string): EmporixNotFoundError =>
  new EmporixNotFoundError("Not Found", 404, { code: 404, status: "Not Found", message });

/** A `207` body: one result per command, in order, as Emporix answers a chain. */
function chain(...rows: { type: string; code: number; data?: unknown }[]) {
  return { results: rows.map((row, index) => ({ index, status: "", ...row })) };
}

const lines = (n: number) => ({ id: "my-cart", items: Array.from({ length: n }, (_, i) => ({ id: String(i) })) });
const missing = (message: string) => ({ code: 404, status: "Not Found", message });

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

describe("a cart write is one request: the write, then the cart read", () => {
  it("sends a quantity change and the read as one chain, and counts from the read", async () => {
    const execute = vi.fn(async () => chain({ type: "UpdateCartItem", code: 204 }, { type: "GetCart", code: 200, data: lines(3) }));
    s.client = { carts: { execute } };

    const state = await setQuantity({ error: null }, form({ itemId: "9", quantity: "3" }));

    expect(state.error).toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      "my-cart",
      [{ type: "UpdateCartItem", data: { quantity: 3 }, options: { itemId: "9", partial: true } }, GET_CART],
      ANON,
      { onError: "resume" },
    );
    expect(s.store.get("demo.cartCount")).toBe("3");
  });

  it("chains the coupon commands with the read", async () => {
    const execute = vi.fn(async (_cartId: string, _commands: unknown[]) =>
      chain({ type: "ApplyCartDiscount", code: 201 }, { type: "GetCart", code: 200, data: lines(2) }),
    );
    s.client = { carts: { execute } };

    await applyCoupon({ error: null }, form({ code: " SAVE10 " }));
    await removeCoupon({ error: null }, form({ code: "SAVE10" }));

    expect(execute.mock.calls.map((c) => c[1])).toEqual([
      [{ type: "ApplyCartDiscount", data: { code: "SAVE10" } }, GET_CART],
      [{ type: "DeleteCartDiscounts", options: { codes: ["SAVE10"] } }, GET_CART],
    ]);
  });

  it("surfaces a failed read and keeps the cart", async () => {
    s.client = {
      carts: {
        execute: async () =>
          chain({ type: "DeleteCartItem", code: 204 }, { type: "GetCart", code: 500, data: { code: 500, status: "Internal Server Error", message: "boom" } }),
      },
    };

    const state = await removeLine({ error: null }, form({ itemId: "9" }));

    expect(state.error).toContain("boom");
    expect(s.store.get("emporix.cartId")).toBe("my-cart");
    expect(s.store.get("demo.cartCount")).toBe("2");
  });
});

describe("adding to the cart", () => {
  const matchByContext = async () => [{ priceId: "pr1", currency: "CHF", effectiveValue: 10 }];
  const added = { type: "AddCartItem", code: 201, data: { itemId: "1", yrn: "y" } };
  const item = {
    itemYrn: "urn:yaas:hybris:product:product:viu;p1",
    quantity: 1,
    price: { priceId: "pr1", originalAmount: 10, effectiveAmount: 10, currency: "CHF" },
  };

  it("adds and reads back in one chain", async () => {
    const execute = vi.fn(async () => chain(added, { type: "GetCart", code: 200, data: lines(3) }));
    s.client = { tenant: "viu", prices: { matchByContext }, carts: { execute } };

    await addToCart("p1");

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith("my-cart", [{ type: "AddCartItem", data: item }, GET_CART], ANON);
    expect(s.store.get("demo.cartCount")).toBe("3");
  });

  it("starts a fresh cart when the add 404s — that 404 is the cart's", async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(notFound("Cart with code my-cart not found."))
      .mockResolvedValueOnce(chain(added, { type: "GetCart", code: 200, data: { id: "new-cart", items: [{ id: "1" }] } }));
    const getCurrent = vi.fn(async () => ({ id: "new-cart", items: [] }));
    s.client = { tenant: "viu", prices: { matchByContext }, carts: { execute, getCurrent } };

    await addToCart("p1");

    expect(execute.mock.calls.map((c) => c[0])).toEqual(["my-cart", "new-cart"]);
    expect(s.store.get("emporix.cartId")).toBe("new-cart");
    expect(s.store.get("demo.cartCount")).toBe("1");
  });
});

/**
 * Emporix answers a line that is already gone and a coupon code it does not know with
 * the same 404 as a cart a checkout closed — measured on `viu` 2026-09-30. The session
 * used to drop the cart on all three. The chain's own `GetCart` settles it, in the same
 * request as the write.
 */
describe("a cart write that answers 404", () => {
  it("keeps the cart when only the line is gone", async () => {
    // Another tab removed the line first. The cart read says the cart is fine, and
    // its one remaining line is what the badge shows now.
    const execute = vi.fn(async () =>
      chain(
        { type: "DeleteCartItem", code: 404, data: missing("Cart item not found in cart my-cart with code 9") },
        { type: "GetCart", code: 200, data: lines(1) },
      ),
    );
    s.client = { carts: { execute } };

    const state = await removeLine({ error: null }, form({ itemId: "9" }));

    expect(state.error).toContain("Cart item not found");
    expect(s.store.get("emporix.cartId")).toBe("my-cart");
    expect(s.store.get("demo.cartCount")).toBe("1");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("keeps the cart when the coupon code is unknown", async () => {
    // The likelier way in: a mistyped code.
    s.client = {
      carts: {
        execute: async () =>
          chain(
            { type: "ApplyCartDiscount", code: 404, data: missing("Coupon with code NOPE not found.") },
            { type: "GetCart", code: 200, data: lines(2) },
          ),
      },
    };

    const state = await applyCoupon({ error: null }, form({ code: "NOPE" }));

    expect(state.error).toContain("Coupon with code NOPE not found.");
    expect(s.store.get("emporix.cartId")).toBe("my-cart");
  });

  it("drops the cart when the cart read 404s too", async () => {
    // Closed by a checkout on another device. `GET /carts/{id}` names nothing but the
    // cart, so its 404 is the one that settles it.
    s.client = {
      carts: {
        execute: async () =>
          chain(
            { type: "DeleteCartItem", code: 404, data: missing("Cart with code my-cart not found.") },
            { type: "GetCart", code: 404, data: missing("Cart with code my-cart not found.") },
          ),
      },
    };

    await removeLine({ error: null }, form({ itemId: "9" }));

    expect(s.store.has("emporix.cartId")).toBe(false);
    expect(s.store.has("demo.cartCount")).toBe(false);
  });
});
