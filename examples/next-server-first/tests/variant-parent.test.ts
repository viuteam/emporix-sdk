import { describe, expect, it } from "vitest";
import type { Product } from "@viu/emporix-sdk";
import { isVariantParent } from "@viu/emporix-examples-shared";

/**
 * `isVariantParent` lives in `examples/shared` and is tested from here, like
 * `stripHtml`. It decides whether a product page asks Emporix for variant
 * children at all: only a PARENT_VARIANT has VARIANT children for the variant
 * nav. A dynamic-variant root's descendants come from its `variants` map.
 */
describe("isVariantParent", () => {
  it("is true for a parent variant", () => {
    expect(isVariantParent({ id: "p", productType: "PARENT_VARIANT" } as Product)).toBe(true);
  });

  it("is false for every other type, including a dynamic-variant root", () => {
    // A DYNAMIC_VARIANT's children are DYNAMIC_VARIANT too; the page renders them
    // from the root's `variants` map, not from the variant nav.
    for (const productType of ["BASIC", "VARIANT", "BUNDLE", "DYNAMIC_VARIANT"] as const) {
      expect(isVariantParent({ id: "p", productType } as Product)).toBe(false);
    }
  });

  it("is false when the product carries no type", () => {
    expect(isVariantParent({ id: "p" } as Product)).toBe(false);
  });
});
