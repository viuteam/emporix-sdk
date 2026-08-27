import { useState } from "react";
import { ProductList } from "./ProductList";
import { BrandAdmin } from "./admin/BrandAdmin";
import { LabelAdmin } from "./admin/LabelAdmin";

type View = "products" | "brands" | "labels";

const LABELS: Record<View, string> = {
  products: "Products",
  brands: "Brands",
  labels: "Labels",
};

/**
 * Switches between the module's views.
 *
 * Plain state and a ternary, deliberately not a router: a federation remote must
 * not own history. The dashboard owns the URL, and a nested router fights it for
 * the back button.
 */
export function Nav(): React.JSX.Element {
  const [view, setView] = useState<View>("products");
  return (
    <>
      <nav style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        {(Object.keys(LABELS) as View[]).map((v) => (
          <button key={v} type="button" disabled={v === view} onClick={() => setView(v)}>
            {LABELS[v]}
          </button>
        ))}
      </nav>
      {view === "products" ? (
        <ProductList />
      ) : view === "brands" ? (
        <BrandAdmin />
      ) : (
        <LabelAdmin />
      )}
    </>
  );
}
