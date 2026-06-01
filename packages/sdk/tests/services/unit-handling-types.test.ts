import { describe, it, expectTypeOf } from "vitest";
import type {
  Unit,
  UnitInput,
  UnitUpdate,
  UnitCreated,
  ConversionFactorInput,
  ConversionFactorResult,
  ConvertUnitInput,
  ConvertUnitResult,
} from "../../src/services/unit-handling-types";

describe("unit handling types", () => {
  it("types are usable", () => {
    expectTypeOf<Unit>().not.toBeNever();
    expectTypeOf<UnitInput>().not.toBeNever();
    expectTypeOf<UnitUpdate>().not.toBeNever();
    expectTypeOf<UnitCreated>().not.toBeNever();
    expectTypeOf<ConversionFactorInput>().not.toBeNever();
    expectTypeOf<ConversionFactorResult>().not.toBeNever();
    expectTypeOf<ConvertUnitInput>().not.toBeNever();
    expectTypeOf<ConvertUnitResult>().not.toBeNever();
  });
});
