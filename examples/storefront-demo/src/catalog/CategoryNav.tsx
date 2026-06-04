import { Link } from "react-router-dom";
import { useCategoryTree } from "@viu/emporix-sdk-react";
import { catId, catLabel } from "../lib/adapters";

// Top-level navigation = the curated category-tree roots (not the flat
// `categories.list()` dump, which mixes in every leaf category).
export function CategoryNav() {
  const { data } = useCategoryTree();
  const cats = data ?? [];
  if (cats.length === 0) return null;
  return (
    <nav className="catnav" aria-label="Categories">
      {cats.map((c) => {
        const id = catId(c);
        return (
          <Link key={id} to={`/category/${encodeURIComponent(id)}`} className="u-underline">
            {catLabel(c)}
          </Link>
        );
      })}
    </nav>
  );
}
