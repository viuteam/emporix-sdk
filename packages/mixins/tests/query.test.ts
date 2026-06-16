import { describe, it, expect } from "vitest";
import { mixinQuery, and, or, raw } from "../src/index";
import type { MixinDescriptor } from "../src/index";

const COLOR: MixinDescriptor<
  { color?: string; qty?: number; inStock?: boolean; title?: string },
  "PRODUCT"
> = {
  key: "attrs",
  entity: "PRODUCT",
  url: "https://cdn/attrs.v1.json",
  version: 1,
};

describe("mixinQuery — operators", () => {
  it("renders a bare value as equals", () => {
    expect(mixinQuery(COLOR, { color: "Blue" }).toString()).toBe("mixins.attrs.color:Blue");
  });

  it("renders explicit { eq }", () => {
    expect(mixinQuery(COLOR, { color: { eq: "Blue" } }).toString()).toBe("mixins.attrs.color:Blue");
  });

  it("renders a single comparison without parentheses", () => {
    expect(mixinQuery(COLOR, { qty: { gt: 20 } }).toString()).toBe("mixins.attrs.qty:>20");
  });

  it("renders a numeric range with parentheses", () => {
    expect(mixinQuery(COLOR, { qty: { gte: 10, lte: 20 } }).toString()).toBe(
      "mixins.attrs.qty:(>=10 AND <=20)",
    );
  });

  it("renders an in-list", () => {
    expect(mixinQuery(COLOR, { color: { in: ["Blue", "Black"] } }).toString()).toBe(
      "mixins.attrs.color:(Blue,Black)",
    );
  });

  it("renders a regex with ~", () => {
    expect(mixinQuery(COLOR, { color: { regex: "Bl" } }).toString()).toBe("mixins.attrs.color:~Bl");
  });

  it("renders booleans", () => {
    expect(mixinQuery(COLOR, { inStock: true }).toString()).toBe("mixins.attrs.inStock:true");
  });

  it("renders exists / missing", () => {
    expect(mixinQuery(COLOR, { color: { exists: true } }).toString()).toBe("mixins.attrs.color:exists");
    expect(mixinQuery(COLOR, { color: { exists: false } }).toString()).toBe("mixins.attrs.color:missing");
  });

  it("space-joins multiple clauses (implicit AND)", () => {
    expect(mixinQuery(COLOR, { color: "Blue", inStock: true }).toString()).toBe(
      "mixins.attrs.color:Blue mixins.attrs.inStock:true",
    );
  });

  it("supports a path prefix for embedded mixins", () => {
    expect(mixinQuery(COLOR, { color: "Blue" }, { prefix: "customer" }).toString()).toBe(
      "customer.mixins.attrs.color:Blue",
    );
  });

  it("renders a localized attribute with the language segment", () => {
    expect(mixinQuery(COLOR, { title: { lang: "en", eq: "Sale" } }).toString()).toBe(
      "mixins.attrs.title.en:Sale",
    );
  });

  it("renders a localized regex match", () => {
    expect(mixinQuery(COLOR, { title: { lang: "de", regex: "ange" } }).toString()).toBe(
      "mixins.attrs.title.de:~ange",
    );
  });

  it("throws on whitespace in a value (unverified escaping)", () => {
    expect(() => mixinQuery(COLOR, { color: "1000 GB" }).toString()).toThrow(/whitespace/i);
  });

  it("throws on an empty where", () => {
    expect(() => mixinQuery(COLOR, {})).toThrow(/empty where/i);
  });
});

describe("combinators", () => {
  it("and() space-joins non-compound filters", () => {
    const q = and(mixinQuery(COLOR, { color: "Blue" }), mixinQuery(COLOR, { inStock: true }));
    expect(q.toString()).toBe("mixins.attrs.color:Blue mixins.attrs.inStock:true");
    expect(q.usesCompound).toBe(false);
  });

  it("or() emits compoundLogicalQuery and flags usesCompound", () => {
    const q = or(mixinQuery(COLOR, { color: "Blue" }), mixinQuery(COLOR, { color: "Black" }));
    expect(q.toString()).toBe(
      "compoundLogicalQuery:((mixins.attrs.color:Blue) OR (mixins.attrs.color:Black))",
    );
    expect(q.usesCompound).toBe(true);
  });

  it("and() with a compound child becomes a compoundLogicalQuery AND", () => {
    const q = and(
      mixinQuery(COLOR, { inStock: true }),
      or(mixinQuery(COLOR, { color: "Blue" }), mixinQuery(COLOR, { color: "Black" })),
    );
    expect(q.toString()).toBe(
      "compoundLogicalQuery:((mixins.attrs.inStock:true) AND " +
        "(compoundLogicalQuery:((mixins.attrs.color:Blue) OR (mixins.attrs.color:Black))))",
    );
    expect(q.usesCompound).toBe(true);
  });

  it("raw() is an entity-agnostic passthrough that composes with and()", () => {
    const q = and(mixinQuery(COLOR, { color: "Blue" }), raw("published:true"));
    expect(q.toString()).toBe("mixins.attrs.color:Blue published:true");
  });

  it("build() equals toString()", () => {
    const q = mixinQuery(COLOR, { color: "Blue" });
    expect(q.build()).toBe(q.toString());
  });
});
