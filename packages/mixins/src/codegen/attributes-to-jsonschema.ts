import type { JsonSchema } from "../runtime/types";

/** Minimal shape of an Emporix schema attribute (from the Schema Service). */
interface Attr {
  key: string;
  type: string; // TEXT | NUMBER | BOOLEAN | OBJECT | ARRAY | ENUM | …
  required?: boolean;
  arrayType?: string; // element type when type === "ARRAY"
  values?: string[]; // enum values when type === "ENUM"
  attributes?: Attr[]; // nested when type === "OBJECT"
}

const SCALAR: Record<string, JsonSchema> = {
  TEXT: { type: "string" },
  STRING: { type: "string" },
  NUMBER: { type: "number" },
  DECIMAL: { type: "number" },
  INTEGER: { type: "integer" },
  BOOLEAN: { type: "boolean" },
};

function attrToSchema(a: Attr): JsonSchema {
  if (a.type === "OBJECT") return attributesToJsonSchema(a.attributes ?? []);
  if (a.type === "ARRAY") {
    const item = a.arrayType ? (SCALAR[a.arrayType] ?? { type: "string" }) : { type: "string" };
    return { type: "array", items: item };
  }
  if (a.type === "ENUM") return { type: "string", enum: a.values ?? [] };
  return SCALAR[a.type] ?? {};
}

/** Converts Emporix schema attributes into a JSON Schema object (fallback path). */
export function attributesToJsonSchema(attributes: Attr[]): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const a of attributes) {
    properties[a.key] = attrToSchema(a);
    if (a.required) required.push(a.key);
  }
  const out: JsonSchema = { type: "object", additionalProperties: false, properties };
  if (required.length) (out as { required?: string[] }).required = required;
  return out;
}
