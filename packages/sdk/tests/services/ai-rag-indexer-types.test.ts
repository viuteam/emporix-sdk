import { describe, it, expectTypeOf } from "vitest";
import type { MetadataFilter, RagType } from "../../src/services/ai-rag-indexer-types";

describe("ai rag indexer types", () => {
  it("MetadataFilter has key + a field-type union", () => {
    const f: MetadataFilter = { key: "price", type: "float" };
    expectTypeOf(f.key).toEqualTypeOf<string | undefined>(); // generated `key` is optional
    // `type` accepts every documented field type
    const types: MetadataFilter["type"][] = [
      "string", "integer", "float", "boolean",
      "datetime", "date", "time", "dictionary", "list", "object",
    ];
    expectTypeOf(types).toEqualTypeOf<MetadataFilter["type"][]>();
  });

  it("RagType is the PRODUCT literal", () => {
    const t: RagType = "PRODUCT";
    expectTypeOf(t).toEqualTypeOf<RagType>();
  });
});
