import { describe, it, expectTypeOf } from "vitest";
import type { IndexConfig, IndexConfigCreated, IndexPublicConfig, ReindexInput } from "../../src/services/indexing-types";

describe("indexing types", () => {
  it("types are usable", () => {
    expectTypeOf<IndexConfig>().not.toBeNever();
    expectTypeOf<IndexConfigCreated>().not.toBeNever();
    expectTypeOf<IndexPublicConfig>().not.toBeNever();
    expectTypeOf<ReindexInput>().not.toBeNever();
  });
});
