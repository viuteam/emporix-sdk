import { describe, expect, it } from "vitest";
import type { CategoryNode } from "@viu/emporix-sdk";
// From `category-walk`, not `category-tree`: the latter imports `siteContext`,
// which reaches the server-only session entry and throws under vitest.
import { findCategory } from "../app/lib/category-walk";

/**
 * Shaped like the real thing: `id`, `name`, `localizedName`, `position` and
 * `published` are required on `CategoryTree`, so a fixture missing one does not
 * compile. The three-level nesting and the duplicate name are both taken from the
 * `viu` tenant — it has three roots called «Sports & Outdoor».
 */
function node(id: string, name: string, children?: CategoryNode[]): CategoryNode {
  return {
    id,
    name,
    localizedName: { en: name },
    position: 1,
    published: true,
    ...(children ? { subcategories: children } : {}),
  };
}

const TREE: CategoryNode[] = [
  node("fitness", "Fitness"),
  node("so-1", "Sports & Outdoor", [
    node("cycling", "Cycling", [node("helmets", "Bike Helmets & Protection")]),
  ]),
  node("so-2", "Sports & Outdoor", [node("empty-child", "Cycling")]),
];

describe("findCategory", () => {
  it("finds a root and reports no ancestors", () => {
    const found = findCategory(TREE, "fitness");
    expect(found?.node.id).toBe("fitness");
    expect(found?.ancestors).toEqual([]);
  });

  it("finds a level-3 node with its ancestors, root first", () => {
    const found = findCategory(TREE, "helmets");
    expect(found?.node.id).toBe("helmets");
    expect(found?.ancestors.map((a) => a.id)).toEqual(["so-1", "cycling"]);
  });

  it("returns null for an id the tree does not have", () => {
    expect(findCategory(TREE, "no-such-id")).toBeNull();
  });

  it("walks past a node that has no subcategories field at all", () => {
    // `fitness` has none. Reaching `so-1` afterwards proves the walk did not stop.
    expect(findCategory(TREE, "so-1")?.node.id).toBe("so-1");
  });

  it("does not confuse two nodes that share a name", () => {
    // Three roots on the tenant are called «Sports & Outdoor» and only one is
    // stocked. Matching on the label instead of the id would send a shopper to
    // an empty one.
    expect(findCategory(TREE, "so-2")?.node.id).toBe("so-2");
    expect(findCategory(TREE, "empty-child")?.ancestors.map((a) => a.id)).toEqual(["so-2"]);
  });
});
