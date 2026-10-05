import { Link } from "react-router-dom";
import { useVariantChildren } from "@viu/emporix-sdk-react";
import { catId, productName } from "../lib/adapters";

export function VariantPicker({ productId }: { productId: string }) {
  const { data } = useVariantChildren(productId);
  const variants = data ?? [];
  if (variants.length === 0) return null;
  return (
    <div className="variants">
      <span className="field__label">Variants</span>
      <div className="cluster variants__list">
        {variants.map((v) => (
          <Link key={catId(v)} to={`/product/${encodeURIComponent(catId(v))}`} className="tag">
            {productName(v)}
          </Link>
        ))}
      </div>
    </div>
  );
}
