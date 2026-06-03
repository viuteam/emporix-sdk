import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import type { ProductCardVM, PriceVM } from "../lib/adapters";
import { money } from "../lib/format";

export function ProductCard({
  vm,
  price,
  index,
  lead = false,
}: {
  vm: ProductCardVM;
  price?: PriceVM | undefined;
  index: number;
  lead?: boolean;
}) {
  return (
    <Link
      to={`/product/${encodeURIComponent(vm.code)}`}
      className={`pc reveal${lead ? " pc--lead" : ""}`}
      style={{ "--i": index % 12 } as CSSProperties}
    >
      <div className="pc__media">
        {vm.image ? <img src={vm.image} alt={vm.imageAlt} loading="lazy" /> : <div className="pc__ph" />}
      </div>
      <div className="pc__meta">
        <span className="index">no. {String(index + 1).padStart(2, "0")}</span>
        <span className="pc__name">
          <span className="u-underline">{vm.name}</span>
        </span>
        {price ? <span className="price pc__price">{money(price.amount, price.currency)}</span> : null}
      </div>
    </Link>
  );
}
