import { Link } from "react-router-dom";
import { useCategories } from "@viu/emporix-sdk-react";
import { catId, catLabel } from "../lib/adapters";

export function CategoryNav() {
  const { data } = useCategories({ pageSize: 12 });
  const cats = data?.items ?? [];
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
