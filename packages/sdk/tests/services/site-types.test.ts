import { describe, it, expectTypeOf } from "vitest";
import type { Site, SiteAddress, SiteHomeBase } from "../../src/services/site-types";

describe("site types", () => {
  it("derives from the generated SiteDto but keeps active/default required", () => {
    expectTypeOf<Site>().not.toBeNever();
    expectTypeOf<Site["active"]>().toEqualTypeOf<boolean>();
    expectTypeOf<Site["default"]>().toEqualTypeOf<boolean>();
    // inherited from the generated SiteDto (proves derivation)
    expectTypeOf<Site["taxDeterminationBasedOn"]>().toEqualTypeOf<
      "BILLING_ADDRESS" | "SHIPPING_ADDRESS"
    >();
    expectTypeOf<SiteAddress>().not.toBeNever();
    expectTypeOf<SiteHomeBase>().not.toBeNever();
  });
});
