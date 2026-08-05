import { describe, expect, it } from "vitest";
import { buildIndex } from "../app/lib/category-index";

const TREE = [
  {
    id: "root",
    name: { en: "Root" },
    subcategories: [
      {
        id: "kid",
        name: { en: "Kid" },
        subcategories: [{ id: "grandkid", name: { en: "Grandkid" } }],
      },
    ],
  },
] as never;

describe("buildIndex", () => {
  it("flattens every node into a lookup", () => {
    expect(Object.keys(buildIndex(TREE).byId).sort()).toEqual(["grandkid", "kid", "root"]);
  });

  it("carries the breadcrumb path, root first", () => {
    // The page renders this directly, so the order is the contract — reversed
    // ancestors would read as «Grandkid › Kid › Root».
    expect(buildIndex(TREE).byId["grandkid"]?.path.map((p) => p.id)).toEqual(["root", "kid"]);
    expect(buildIndex(TREE).byId["root"]?.path).toEqual([]);
  });

  it("carries the direct children only", () => {
    expect(buildIndex(TREE).byId["root"]?.children.map((c) => c.id)).toEqual(["kid"]);
    expect(buildIndex(TREE).byId["grandkid"]?.children).toEqual([]);
  });

  it("lists the roots for the overview page", () => {
    expect(buildIndex(TREE).roots.map((r) => r.id)).toEqual(["root"]);
  });

  it("survives a node without subcategories or name", () => {
    // 1'631 nodes come off the tenant; assuming every one is well-formed is how
    // a single missing field 500s a category page.
    const idx = buildIndex([{ id: "bare" }] as never);
    expect(idx.byId["bare"]).toEqual({ id: "bare", label: "bare", path: [], children: [] });
  });

  it("skips a node with no id instead of indexing it under undefined", () => {
    // An id-less node cannot be linked to, so it has no place in a lookup keyed
    // by id — and `byId["undefined"]` would be a trap for the next reader.
    const idx = buildIndex([
      { id: "ok", name: { en: "Ok" }, subcategories: [{ name: { en: "Nameless" } }] },
    ] as never);
    expect(Object.keys(idx.byId)).toEqual(["ok"]);
    expect(idx.byId["ok"]?.children).toEqual([]);
  });

  it("keeps three roots with the same label apart by id", () => {
    // Measured on the tenant: three roots are called «Sports & Outdoor» and only
    // one carries products. Matching on the label would pick the wrong one.
    const idx = buildIndex([
      { id: "a", name: { en: "Sports & Outdoor" } },
      { id: "b", name: { en: "Sports & Outdoor" } },
    ] as never);
    expect(Object.keys(idx.byId).sort()).toEqual(["a", "b"]);
  });
});
