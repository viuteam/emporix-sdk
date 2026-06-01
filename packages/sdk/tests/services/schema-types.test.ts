import { describe, it, expectTypeOf } from "vitest";
import type {
  Schema,
  SchemaTypeName,
  CustomEntity,
  CustomInstance,
  SchemaDraft,
  CustomInstanceDraft,
  ListSchemasQuery,
  ListInstancesQuery,
  ListCustomEntitiesOptions,
} from "../../src/services/schema-types";

describe("schema types", () => {
  it("Schema / CustomEntity are usable object types", () => {
    expectTypeOf<Schema>().not.toBeNever();
    expectTypeOf<CustomEntity>().not.toBeNever();
    const s = { id: "s1", types: ["PRODUCT"], attributes: [] } as Schema;
    expectTypeOf(s.id).toEqualTypeOf<string | undefined>();
  });

  it("SchemaTypeName includes the documented entity types", () => {
    const t: SchemaTypeName = "PRODUCT";
    expectTypeOf(t).toMatchTypeOf<SchemaTypeName>();
  });

  it("CustomInstance<T> types mixins as T", () => {
    const i = {
      id: "i1",
      name: { en: "n" },
      type: "shoe",
      owner: { type: "SERVICE", userId: "u" },
      mixins: { size: 42 },
      metadata: { version: 1 },
    } as CustomInstance<{ size: number }>;
    expectTypeOf(i.mixins).toEqualTypeOf<{ size: number }>();
  });

  it("CustomInstance defaults mixins to an object record", () => {
    const i = {} as CustomInstance;
    expectTypeOf(i.mixins).toEqualTypeOf<Record<string, unknown>>();
  });

  it("SchemaDraft has name/types/attributes", () => {
    const d: SchemaDraft = { name: { en: "Shoe" }, types: ["CUSTOM_ENTITY"], attributes: [] };
    expectTypeOf(d.types).toMatchTypeOf<SchemaTypeName[]>();
  });

  it("CustomInstanceDraft<T> types mixins as T", () => {
    const d: CustomInstanceDraft<{ size: number }> = {
      name: { en: "n" },
      mixins: { size: 1 },
    };
    expectTypeOf(d.mixins).toEqualTypeOf<{ size: number }>();
  });

  it("query option interfaces expose the documented fields", () => {
    const s: ListSchemasQuery = { q: "name:x", type: "PRODUCT", pageNumber: 1, pageSize: 10 };
    expectTypeOf(s.type).toEqualTypeOf<SchemaTypeName | undefined>();
    const li: ListInstancesQuery = { pageNumber: 2, pageSize: 5 };
    expectTypeOf(li.pageSize).toEqualTypeOf<number | undefined>();
    const ce: ListCustomEntitiesOptions = { expandSchemas: true };
    expectTypeOf(ce.expandSchemas).toEqualTypeOf<boolean | undefined>();
  });
});
