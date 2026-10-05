import { Link } from "react-router-dom";
import { useCategoryTree } from "@viu/emporix-sdk-react";
import { catId, catLabel } from "../lib/adapters";

/** Roots shown as chips before «All categories» takes over. */
const CHIPS = 6;

// Top-level navigation = the curated category-tree roots (not the flat
// `categories.list()` dump, which mixes in every leaf category).
export function CategoryNav() {
  const { data } = useCategoryTree();
  const cats = data ?? [];
  if (cats.length === 0) return null;
  return (
    <nav className="chips" aria-label="Categories">
      {cats.slice(0, CHIPS).map((c) => (
        <Link key={catId(c)} to={`/category/${encodeURIComponent(catId(c))}`} className="tag">
          {catLabel(c)}
        </Link>
      ))}
      {cats.length > CHIPS ? (
        <Link to="/categories" className="tag">
          All categories →
        </Link>
      ) : null}
    </nav>
  );
}
