import { describe, it, expectTypeOf } from "vitest";
import type {
  TaxClass,
  TaxConfig,
  TaxConfigInput,
  TaxConfigCreated,
  TaxCalculationRequest,
  TaxCalculationResult,
} from "../../src/services/tax-types";

describe("tax types", () => {
  it("TaxConfig exposes locationCode and a taxClasses array", () => {
    const c: TaxConfig = { locationCode: "DE", taxClasses: [] };
    expectTypeOf(c.locationCode).toEqualTypeOf<string>();
    expectTypeOf(c.taxClasses).toBeArray();
  });

  it("TaxClass carries code, name and rate", () => {
    // Upstream requires `name` (localized map or plain string) and `rate`.
    const t: TaxClass = { code: "STANDARD", name: "Standard", rate: 19 };
    expectTypeOf(t.code).toEqualTypeOf<string>();
  });

  it("TaxConfigInput accepts a location and tax classes", () => {
    const i: TaxConfigInput = { location: { countryCode: "DE" }, taxClasses: [] };
    expectTypeOf(i.taxClasses).toBeArray();
  });

  it("TaxConfigCreated returns the locationCode", () => {
    const r: TaxConfigCreated = { locationCode: "DE" };
    expectTypeOf(r.locationCode).toEqualTypeOf<string>();
  });

  it("TaxCalculationRequest holds an input; result exposes output", () => {
    const req: TaxCalculationRequest = {
      input: { targetLocation: { countryCode: "DE" }, targetTaxClass: "STANDARD", price: 100 },
    };
    expectTypeOf(req.input.price).toEqualTypeOf<number>();
    // Output field names mirror the upstream Tax Service: netPrice / grossPrice / *TaxRate.
    const res: TaxCalculationResult = { output: { netPrice: 100, grossPrice: 119 } };
    expectTypeOf(res.output?.grossPrice).toEqualTypeOf<number | undefined>();
  });
});
