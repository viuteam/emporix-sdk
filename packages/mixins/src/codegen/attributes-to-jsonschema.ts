import type { JsonSchema } from "../runtime/types";

/** Shape of an Emporix schema attribute, as the Schema Service returns it. */
interface Attr extends Value {
  key: string;
  metadata?: { required?: boolean; localized?: boolean; nullable?: boolean };
}

/** What an attribute and an ARRAY's `arrayType` have in common. */
interface Value {
  type: string; // TEXT | NUMBER | DECIMAL | BOOLEAN | DATE | TIME | DATE_TIME | ENUM | ARRAY | OBJECT | REFERENCE
  values?: { value: string }[]; // allowed values when type === "ENUM"
  attributes?: Attr[]; // nested when type === "OBJECT"
  arrayType?: ArrayItem; // element when type === "ARRAY"
}

/** An ARRAY attribute's element. */
interface ArrayItem extends Value {
  localized?: boolean;
  nullable?: boolean;
}

const SCALAR: Record<string, JsonSchema> = {
  TEXT: { type: "string" },
  STRING: { type: "string" },
  NUMBER: { type: "number" },
  DECIMAL: { type: "number" },
  INTEGER: { type: "integer" },
  BOOLEAN: { type: "boolean" },
  DATE: { type: "string" },
  TIME: { type: "string" },
  DATE_TIME: { type: "string" },
};

const orNull = (s: JsonSchema): JsonSchema => ({ anyOf: [s, { type: "null" }] });

/**
 * A localized value. With `languageSchemaVersion` v2 it is a map keyed by
 * language; with v1 a `TEXT` is an array of `{ language, value }` and an
 * `OBJECT` cannot be localized. The attributes do not say which version the
 * tenant runs, so a localized `TEXT` admits both shapes.
 */
function localize(value: JsonSchema, type: string): JsonSchema {
  const v2: JsonSchema = { type: "object", additionalProperties: value };
  if (type !== "TEXT") return v2;
  const v1: JsonSchema = {
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      required: ["language", "value"],
      properties: { language: { type: "string" }, value },
    },
  };
  return { anyOf: [v2, v1] };
}

function valueSchema(v: Value): JsonSchema {
  if (v.type === "OBJECT") return attributesToJsonSchema(v.attributes ?? []);
  if (v.type === "ARRAY") {
    const i = v.arrayType;
    return { type: "array", items: i ? finish(valueSchema(i), i.type, i.localized, i.nullable) : { type: "string" } };
  }
  if (v.type === "ENUM") return { type: "string", enum: (v.values ?? []).map((e) => e.value) };
  return SCALAR[v.type] ?? {};
}

/** Applies `localized` and `nullable`: a nullable localized value may be `null` per language and as a whole. */
function finish(s: JsonSchema, type: string, localized?: boolean, nullable?: boolean): JsonSchema {
  const out = localized ? localize(nullable ? orNull(s) : s, type) : s;
  return nullable ? orNull(out) : out;
}

/** Converts Emporix schema attributes into a JSON Schema object (fallback path). */
export function attributesToJsonSchema(attributes: Attr[]): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const a of attributes) {
    properties[a.key] = finish(valueSchema(a), a.type, a.metadata?.localized, a.metadata?.nullable);
    if (a.metadata?.required) required.push(a.key);
  }
  const out: JsonSchema = { type: "object", additionalProperties: false, properties };
  if (required.length) (out as { required?: string[] }).required = required;
  return out;
}
