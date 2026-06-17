import { describe, it, expect } from "vitest";
import { resolveQuery } from "../../src/core/query";

describe("resolveQuery", () => {
  it("passes a raw string through unchanged", () => {
    expect(resolveQuery("mixins.attrs.color:Blue", { compoundLogicalQuery: false })).toBe(
      "mixins.attrs.color:Blue",
    );
  });

  it("coerces a built filter via toString()", () => {
    const filter = { toString: () => "mixins.attrs.color:Blue", usesCompound: false };
    expect(resolveQuery(filter, { compoundLogicalQuery: false })).toBe("mixins.attrs.color:Blue");
  });

  it("allows a compound filter when the service supports it", () => {
    const filter = { toString: () => "compoundLogicalQuery:((a) OR (b))", usesCompound: true };
    expect(resolveQuery(filter, { compoundLogicalQuery: true })).toBe(
      "compoundLogicalQuery:((a) OR (b))",
    );
  });

  it("throws when a compound filter targets a non-compound service", () => {
    const filter = { toString: () => "compoundLogicalQuery:((a) OR (b))", usesCompound: true };
    expect(() => resolveQuery(filter, { compoundLogicalQuery: false })).toThrow(/does not support/i);
  });
});
