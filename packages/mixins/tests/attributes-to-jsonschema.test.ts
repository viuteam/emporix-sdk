import { describe, it, expect } from "vitest";
import { attributesToJsonSchema } from "../src/codegen/attributes-to-jsonschema";

describe("attributesToJsonSchema", () => {
  it("maps Emporix attribute types to a JSON Schema object", () => {
    const schema = attributesToJsonSchema([
      { key: "packaging", type: "TEXT", required: true },
      { key: "count", type: "NUMBER" },
      { key: "active", type: "BOOLEAN" },
      { key: "tags", type: "ARRAY", arrayType: "TEXT" },
    ] as never);
    expect(schema).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["packaging"],
      properties: {
        packaging: { type: "string" },
        count: { type: "number" },
        active: { type: "boolean" },
        tags: { type: "array", items: { type: "string" } },
      },
    });
  });
});
