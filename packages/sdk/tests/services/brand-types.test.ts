import { describe, it, expectTypeOf } from "vitest";
import type { Brand, BrandList, BrandInput, BrandUpdate } from "../../src/services/brand-types";

describe("brand types", () => {
  it("Brand and BrandList are usable", () => {
    expectTypeOf<Brand>().not.toBeNever();
    expectTypeOf<BrandList>().not.toBeNever();
  });
  it("BrandInput / BrandUpdate are usable as bodies", () => {
    expectTypeOf<BrandInput>().not.toBeNever();
    expectTypeOf<BrandUpdate>().not.toBeNever();
  });
});
