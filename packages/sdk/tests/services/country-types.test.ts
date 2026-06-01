import { describe, it, expectTypeOf } from "vitest";
import type { Country, CountryList, CountryUpdate, Region, RegionList } from "../../src/services/country-types";

describe("country types", () => {
  it("types are usable; lists are arrays", () => {
    expectTypeOf<Country>().not.toBeNever();
    expectTypeOf<CountryList>().toBeArray();
    expectTypeOf<CountryUpdate>().not.toBeNever();
    expectTypeOf<Region>().not.toBeNever();
    expectTypeOf<RegionList>().toBeArray();
  });
});
