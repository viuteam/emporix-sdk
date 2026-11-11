import { describe, it, expectTypeOf } from "vitest";
import type { CartItemInput, CartItemUpdate } from "../../src/services/cart";

// Both bodies failed to compile before the `cart` spec patches (scripts/spec-patches.ts):
// `itemType` was typed as an unsatisfiable string-and-object intersection, and
// `price.priceId` was required although an external item must not send it.
describe("external cart items", () => {
  it("accepts the external-product body from Emporix's guide, without a priceId", () => {
    const external: CartItemInput = {
      itemType: "EXTERNAL",
      product: { id: "service-1", name: "External service" },
      price: { effectiveAmount: 2, originalAmount: 2, currency: "EUR" },
      tax: { name: "STANDARD", rate: 10, grossValue: 2, netValue: 1.82 },
      quantity: 1,
    };
    expectTypeOf(external).toEqualTypeOf<CartItemInput>();
  });

  it("accepts an external price on an update", () => {
    const update: CartItemUpdate = {
      itemType: "EXTERNAL",
      price: { effectiveAmount: 3, originalAmount: 3, currency: "EUR" },
      quantity: 2,
    };
    expectTypeOf(update).toEqualTypeOf<CartItemUpdate>();
  });

  it("still rejects an unknown itemType and a price without amounts or currency", () => {
    // @ts-expect-error itemType is EXTERNAL or INTERNAL
    const unknownType: CartItemInput = { quantity: 1, itemType: "CUSTOM", price: { effectiveAmount: 2, originalAmount: 2, currency: "EUR" } };
    // @ts-expect-error effectiveAmount stays required
    const noAmount: CartItemInput = { quantity: 1, price: { originalAmount: 2, currency: "EUR" } };
    // @ts-expect-error currency stays required
    const noCurrency: CartItemInput = { quantity: 1, price: { originalAmount: 2, effectiveAmount: 2 } };
    expectTypeOf([unknownType, noAmount, noCurrency]).toBeArray();
  });
});
