import { describe, expect, it } from "vitest";
import type { Product } from "@viu/emporix-sdk";
import { isVariantParent } from "@viu/emporix-examples-shared";

/**
 * `isVariantParent` lives in `examples/shared` and is tested from here, like
 * `stripHtml`. It decides whether a product page asks Emporix for variant
 * children at all: `listVariantChildren` searches `productType:VARIANT`, and a
 * VARIANT only ever belongs to a PARENT_VARIANT, so for any other type the
 * request can only answer `[]`.
 */
describe("isVariantParent", () => {
  it("is true for a parent variant", () => {
    expect(isVariantParent({ id: "p", productType: "PARENT_VARIANT" } as Product)).toBe(true);
  });

  it("is false for every other type, including a dynamic-variant root", () => {
    // A DYNAMIC_VARIANT's children are DYNAMIC_VARIANT too, never VARIANT, so the
    // children search cannot find them either.
    for (const productType of ["BASIC", "VARIANT", "BUNDLE", "DYNAMIC_VARIANT"] as const) {
      expect(isVariantParent({ id: "p", productType } as Product)).toBe(false);
    }
  });

  it("is false when the product carries no type", () => {
    expect(isVariantParent({ id: "p" } as Product)).toBe(false);
  });
});
