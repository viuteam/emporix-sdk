import { describe, it, expectTypeOf } from "vitest";
import type { Catalog, CatalogList, CatalogInput, CatalogUpdate, CatalogPatch, CatalogCreated } from "../../src/services/catalog-types";

describe("catalog types", () => {
  it("types are usable", () => {
    expectTypeOf<Catalog>().not.toBeNever();
    expectTypeOf<CatalogList>().toBeArray();
    expectTypeOf<CatalogInput>().not.toBeNever();
    expectTypeOf<CatalogUpdate>().not.toBeNever();
    expectTypeOf<CatalogPatch>().not.toBeNever();
    expectTypeOf<CatalogCreated>().not.toBeNever();
  });
});
