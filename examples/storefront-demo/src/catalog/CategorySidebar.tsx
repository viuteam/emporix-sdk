import { useState } from "react";
import { Link } from "react-router-dom";
import type { CategoryNode } from "@viu/emporix-sdk";
import { useCategoryTree } from "@viu/emporix-sdk-react";
import { catLabel } from "../lib/adapters";

/** The category tree as nested links; the branch holding `activeId` is open. */
export function CategoryTree({ activeId }: { activeId?: string | undefined }) {
  const { data } = useCategoryTree();
  const roots = data ?? [];
  if (roots.length === 0) return null;
  return (
    <ul className="cat-tree">
      {roots.map((n) => (
        <Branch key={n.id} node={n} activeId={activeId} />
      ))}
    </ul>
  );
}

/** The node with `id` anywhere in the tree. */
export function findCategory(nodes: CategoryNode[], id: string): CategoryNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = findCategory(n.subcategories ?? [], id);
    if (hit) return hit;
  }
  return undefined;
}

function contains(node: CategoryNode, id: string | undefined): boolean {
  if (!id) return false;
  return node.id === id || (node.subcategories ?? []).some((c) => contains(c, id));
}

function Branch({ node, activeId }: { node: CategoryNode; activeId?: string | undefined }) {
  const children = node.subcategories ?? [];
  return (
    <li>
      <Link
        to={`/category/${encodeURIComponent(node.id)}`}
        className="cat-tree__link"
        aria-current={node.id === activeId ? "page" : undefined}
      >
        {catLabel(node)}
      </Link>
      {children.length > 0 && contains(node, activeId) ? (
        <ul className="cat-tree">
          {children.map((c) => (
            <Branch key={c.id} node={c} activeId={activeId} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** Left column on category and search pages; behind a button below 48rem. */
export function CategorySidebar({ activeId }: { activeId?: string | undefined }) {
  const [open, setOpen] = useState(false);
  return (
    <aside className="sidebar" aria-label="Categories">
      <button
        type="button"
        className="btn btn--outline btn--sm sidebar__toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        Categories
      </button>
      <div className="sidebar__panel" data-open={open}>
        <p className="sidebar__title">Categories</p>
        <CategoryTree activeId={activeId} />
      </div>
    </aside>
  );
}
