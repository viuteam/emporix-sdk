import { describe, it, expectTypeOf } from "vitest";
import type {
  Schema,
  SchemaTypeName,
  CustomEntity,
  CustomInstance,
  SchemaDraft,
  SchemaTargetType,
  CustomEntityDraft,
  CustomEntityUpdate,
  CustomInstanceDraft,
  CustomInstanceReplace,
  CustomInstancePatch,
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

  it("SchemaDraft has name/types/attributes plus the optional mixin key", () => {
    const d: SchemaDraft = { id: "shoeData", name: { en: "Shoe" }, types: ["CUSTOM_ENTITY"], attributes: [] };
    expectTypeOf(d.types).toEqualTypeOf<SchemaTargetType[]>();
    expectTypeOf(d.id).toEqualTypeOf<string | undefined>();
  });

  it("SchemaTargetType takes the native types and any custom entity type id", () => {
    const native: SchemaTargetType = "PRODUCT";
    const custom: SchemaTargetType = "MERCH_PRINT_ROUND";
    expectTypeOf(native).toMatchTypeOf<SchemaTargetType>();
    expectTypeOf(custom).toMatchTypeOf<SchemaTargetType>();
    expectTypeOf<SchemaTypeName>().toMatchTypeOf<SchemaTargetType>();
  });

  it("CustomEntityDraft requires the id and carries no attributes; CustomEntityUpdate has no id", () => {
    const d: CustomEntityDraft = { id: "SHOE", name: { en: "Shoe" } };
    expectTypeOf(d.id).toEqualTypeOf<string>();
    // @ts-expect-error -- the type id is required on create
    const noId: CustomEntityDraft = { name: { en: "Shoe" } };
    // @ts-expect-error -- attributes live on schemas, not on the custom entity
    const withAttributes: CustomEntityDraft = { id: "SHOE", name: { en: "Shoe" }, attributes: [] };
    const u: CustomEntityUpdate = { name: { en: "Sneaker" }, metadata: { version: 2 } };
    expectTypeOf(u).not.toHaveProperty("id");
    void noId;
    void withAttributes;
  });

  it("CustomInstanceDraft<T> types mixins as T and takes an own id and the mixin metadata", () => {
    const d: CustomInstanceDraft<{ size: number }> = {
      id: "runner",
      name: { en: "n" },
      mixins: { size: 1 },
      metadata: { mixins: { size: "https://cdn/shoe.v1.json" } },
    };
    expectTypeOf(d.mixins).toEqualTypeOf<{ size: number }>();
    expectTypeOf(d.id).toEqualTypeOf<string | undefined>();
  });

  it("CustomInstanceReplace<T> takes metadata.version for optimistic locking", () => {
    const r: CustomInstanceReplace<{ size: number }> = { mixins: { size: 1 }, metadata: { version: 3 } };
    expectTypeOf(r.mixins).toEqualTypeOf<{ size: number }>();
  });

  it("CustomInstancePatch is an RFC-6902 operation array", () => {
    const p: CustomInstancePatch = [{ op: "replace", path: "/mixins/shoe/size", value: 42 }];
    expectTypeOf(p[0]!.op).toEqualTypeOf<"add" | "remove" | "replace">();
  });

  it("query option interfaces expose the documented fields", () => {
    const s: ListSchemasQuery = { q: "name:x", type: "MERCH_PRINT_ROUND", pageNumber: 1, pageSize: 10 };
    expectTypeOf(s.type).toEqualTypeOf<SchemaTargetType | undefined>();
    const li: ListInstancesQuery = { pageNumber: 2, pageSize: 5 };
    expectTypeOf(li.pageSize).toEqualTypeOf<number | undefined>();
    const ce: ListCustomEntitiesOptions = { expandSchemas: true };
    expectTypeOf(ce.expandSchemas).toEqualTypeOf<boolean | undefined>();
  });
});
