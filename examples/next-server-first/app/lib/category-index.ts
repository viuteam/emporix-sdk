import type { CategoryNode } from "@viu/emporix-sdk";
import { catId, catLabel } from "@viu/emporix-examples-shared";

/** One category, with everything a page renders about it and nothing else. */
export interface CategoryEntry {
  id: string;
  label: string;
  /** Ancestors, root first. Empty for a root. */
  path: { id: string; label: string }[];
  children: { id: string; label: string }[];
}

export interface CategoryIndex {
  roots: { id: string; label: string }[];
  byId: Record<string, CategoryEntry>;
}

/**
 * Flattens the tree into a lookup, once, so a render neither walks it nor holds
 * it.
 *
 * The tenant's tree is 1'631 nodes and 378 KiB of full category objects. A
 * category page needed three things out of it — a label, a breadcrumb and the
 * direct children — and got them by walking the whole structure per render
 * (`category-walk.ts`, now unused). The index carries those three and drops the
 * rest.
 *
 * This file has **no runtime imports that reach the server**, and that is the
 * whole reason it is separate from `category-tree.ts`: the cached wrapper needs
 * `categoryTree`, which pulls in `siteContext` and from there
 * `@viu/emporix-sdk-next/session`, whose guard throws the moment vitest resolves
 * it outside the `react-server` condition. It replaces `category-walk.ts`, which
 * existed for exactly this reason and did exactly this job per render.
 */
export function buildIndex(roots: CategoryNode[]): CategoryIndex {
  const byId: Record<string, CategoryEntry> = {};

  const walk = (node: CategoryNode, path: { id: string; label: string }[]): void => {
    const id = catId(node);
    // A node with no id cannot be linked to, so it has no place in a lookup keyed
    // by id. Indexing it under `""` would put a trap in `byId` for the next reader.
    if (id === "") return;
    const kids = (node.subcategories ?? []).filter((k) => catId(k) !== "");
    byId[id] = {
      id,
      label: catLabel(node),
      path,
      children: kids.map((k) => ({ id: catId(k), label: catLabel(k) })),
    };
    const next = [...path, { id, label: catLabel(node) }];
    for (const k of kids) walk(k, next);
  };

  for (const r of roots) walk(r, []);

  return {
    roots: roots.filter((r) => catId(r) !== "").map((r) => ({ id: catId(r), label: catLabel(r) })),
    byId,
  };
}
