import { describe, it, expect } from "vitest";
import { generateTypes } from "../src/codegen/generate";
import type { RawMixin } from "../src/codegen/types";

const raw: RawMixin[] = [
  {
    key: "productCustomAttributes",
    entity: "PRODUCT",
    version: 3,
    url: "https://cdn/productCustomAttributes.v3.json",
    schema: {
      type: "object",
      properties: { color: { type: "string" } },
      additionalProperties: false,
    },
  },
];

describe("generateTypes — entity literal", () => {
  it('casts each registry entry to MixinDescriptor<Name, "ENTITY">', async () => {
    const files = await generateTypes(raw);
    const registry = files["registry.ts"];
    // The interface name may be renormalized by json-schema-to-typescript;
    // assert only the entity literal landed in the cast.
    expect(registry).toMatch(/as MixinDescriptor<\w+, "PRODUCT">/);
  });
});
