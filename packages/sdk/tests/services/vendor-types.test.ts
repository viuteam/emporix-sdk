import { describe, it, expectTypeOf } from "vitest";
import type {
  Vendor,
  VendorList,
  VendorInput,
  VendorUpdate,
  VendorCreated,
  VendorLocation,
  VendorLocationList,
  VendorLocationInput,
  VendorLocationUpdate,
} from "../../src/services/vendor-types";

describe("vendor types", () => {
  it("types are usable", () => {
    expectTypeOf<Vendor>().not.toBeNever();
    expectTypeOf<VendorList>().toBeArray();
    expectTypeOf<VendorInput>().not.toBeNever();
    expectTypeOf<VendorUpdate>().not.toBeNever();
    expectTypeOf<VendorCreated>().not.toBeNever();
    expectTypeOf<VendorLocation>().not.toBeNever();
    expectTypeOf<VendorLocationList>().toBeArray();
    expectTypeOf<VendorLocationInput>().not.toBeNever();
    expectTypeOf<VendorLocationUpdate>().not.toBeNever();
  });
});
