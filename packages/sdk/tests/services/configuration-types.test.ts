import { describe, it, expectTypeOf } from "vitest";
import type {
  Configuration,
  ClientConfiguration,
  ConfigurationDraft,
  ListConfigOptions,
} from "../../src/services/configuration-types";

describe("configuration types", () => {
  it("Configuration<T> types value as T and keeps the base flags", () => {
    const c: Configuration<{ a: number }> = { key: "k", value: { a: 1 }, secured: false };
    expectTypeOf(c.value).toEqualTypeOf<{ a: number }>();
    expectTypeOf(c.secured).toEqualTypeOf<boolean | undefined>();
  });

  it("ClientConfiguration adds _id and client", () => {
    const c: ClientConfiguration<string> = { key: "k", value: "v", _id: "client_k", client: "client" };
    expectTypeOf(c._id).toEqualTypeOf<string>();
    expectTypeOf(c.client).toEqualTypeOf<string>();
  });

  it("ConfigurationDraft requires key/value and rejects server-managed fields", () => {
    const d: ConfigurationDraft = { key: "k", value: true };
    expectTypeOf(d.key).toEqualTypeOf<string>();
    expectTypeOf(d.value).toEqualTypeOf<unknown>();
    // @ts-expect-error `_id` is server-assigned and not part of the draft input
    const withId: ConfigurationDraft = { key: "k", value: true, _id: "x" };
    void withId;
  });

  it("ListConfigOptions.keys is string[]", () => {
    const o: ListConfigOptions = { keys: ["a", "b"] };
    expectTypeOf(o.keys).toEqualTypeOf<string[] | undefined>();
  });
});
