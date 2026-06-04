import { Link } from "react-router-dom";
import { useVariantChildren } from "@viu/emporix-sdk-react";
import { catId, productName } from "../lib/adapters";

export function VariantPicker({ productId }: { productId: string }) {
  const { data } = useVariantChildren(productId);
  const variants = data ?? [];
  if (variants.length === 0) return null;
  return (
    <div style={{ marginTop: "var(--s-5)" }}>
      <span className="field__label">Variants</span>
      <div className="cluster" style={{ marginTop: "var(--s-2)" }}>
        {variants.map((v) => (
          <Link key={catId(v)} to={`/product/${encodeURIComponent(catId(v))}`} className="tag">
            {productName(v)}
          </Link>
        ))}
      </div>
    </div>
  );
}
