import type { CategoryNode } from "@viu/emporix-sdk";

export interface FoundCategory {
  node: CategoryNode;
  /** Root first, immediate parent last. Empty when the node is itself a root. */
  ancestors: CategoryNode[];
}

/**
 * Depth-first search by **id**, returning the node and the path to it.
 *
 * Pure — no call, no cache of its own. The ancestors come along because the walk
 * already knows them, and a breadcrumb is what makes level 4 of a six-level tree
 * navigable rather than disorienting.
 *
 * Matching on the id and not the label matters here: the `viu` tenant has three
 * roots named «Sports & Outdoor» and only one of them has products.
 *
 * This lives apart from `category-tree.ts`, and for the same reason `safe-next.ts`
 * does: that file imports `siteContext`, which reaches
 * `@viu/emporix-sdk-next/session`, whose server-only guard throws the moment vitest
 * resolves it outside the `react-server` condition. Correctly so. The only import
 * here is a `type`, which is erased before anything runs.
 */
export function findCategory(roots: CategoryNode[], id: string): FoundCategory | null {
  for (const root of roots) {
    const hit = walk(root, id, []);
    if (hit !== null) return hit;
  }
  return null;
}

function walk(node: CategoryNode, id: string, ancestors: CategoryNode[]): FoundCategory | null {
  if (node.id === id) return { node, ancestors };
  for (const child of node.subcategories ?? []) {
    const hit = walk(child, id, [...ancestors, node]);
    if (hit !== null) return hit;
  }
  return null;
}
