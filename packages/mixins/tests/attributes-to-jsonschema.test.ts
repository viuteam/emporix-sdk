import { describe, it, expect } from "vitest";
import { attributesToJsonSchema } from "../src/codegen/attributes-to-jsonschema";

const S = { type: "string" };
const orNull = (s: object) => ({ anyOf: [s, { type: "null" }] });
/** A localized TEXT: a v2 language map, or a v1 `[{ language, value }]` array. */
const localizedText = (value: object = S) => ({
  anyOf: [
    { type: "object", additionalProperties: value },
    {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["language", "value"],
        properties: { language: S, value },
      },
    },
  ],
});

describe("attributesToJsonSchema", () => {
  it("maps Emporix attribute types to a JSON Schema object, `required` read from metadata", () => {
    const schema = attributesToJsonSchema([
      { key: "packaging", type: "TEXT", metadata: { required: true } },
      { key: "count", type: "NUMBER", metadata: {} },
      { key: "active", type: "BOOLEAN" },
      { key: "since", type: "DATE_TIME" },
      { key: "weights", type: "ARRAY", arrayType: { type: "DECIMAL" } },
    ]);
    expect(schema).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["packaging"],
      properties: {
        packaging: S,
        count: { type: "number" },
        active: { type: "boolean" },
        since: S,
        weights: { type: "array", items: { type: "number" } },
      },
    });
  });

  it("maps OBJECT (nested), ENUM values, untyped ARRAY, and unknown types", () => {
    const schema = attributesToJsonSchema([
      { key: "addr", type: "OBJECT", attributes: [{ key: "city", type: "TEXT" }] },
      { key: "size", type: "ENUM", values: [{ value: "S" }, { value: "M" }, { value: "L" }] },
      { key: "items", type: "ARRAY" },
      { key: "weird", type: "MYSTERY" },
    ]);
    expect(schema).toEqual({
      type: "object",
      additionalProperties: false,
      properties: {
        addr: { type: "object", additionalProperties: false, properties: { city: S } },
        size: { type: "string", enum: ["S", "M", "L"] },
        items: { type: "array", items: S },
        weird: {},
      },
    });
  });

  it("types a localized TEXT as either language-schema shape, and nullable as `| null`", () => {
    const schema = attributesToJsonSchema([
      { key: "title", type: "TEXT", metadata: { localized: true } },
      { key: "note", type: "TEXT", metadata: { nullable: true } },
    ]);
    expect(schema.properties).toEqual({ title: localizedText(), note: orNull(S) });
  });

  it("types a localized OBJECT as a v2 language map, null per language and as a whole when nullable", () => {
    const schema = attributesToJsonSchema([
      {
        key: "address",
        type: "OBJECT",
        metadata: { localized: true, nullable: true },
        attributes: [{ key: "city", type: "TEXT", metadata: { localized: false } }],
      },
    ]);
    const address = { type: "object", additionalProperties: false, properties: { city: S } };
    expect(schema.properties).toEqual({
      address: orNull({ type: "object", additionalProperties: orNull(address) }),
    });
  });

  it("applies localized, nullable, values and attributes of an ARRAY's arrayType to each item", () => {
    const schema = attributesToJsonSchema([
      { key: "labels", type: "ARRAY", arrayType: { type: "TEXT", localized: true } },
      {
        key: "contentBlocks",
        type: "ARRAY",
        arrayType: { type: "OBJECT", localized: true, attributes: [{ key: "title", type: "TEXT" }] },
      },
      { key: "sizes", type: "ARRAY", arrayType: { type: "ENUM", values: [{ value: "S" }], nullable: true } },
    ]);
    expect(schema.properties).toEqual({
      labels: { type: "array", items: localizedText() },
      contentBlocks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: { type: "object", additionalProperties: false, properties: { title: S } },
        },
      },
      sizes: { type: "array", items: orNull({ type: "string", enum: ["S"] }) },
    });
  });
});
