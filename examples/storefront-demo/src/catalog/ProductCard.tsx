import { Link } from "react-router-dom";
import type { ProductCardVM, PriceVM } from "../lib/adapters";
import { money } from "@viu/emporix-examples-shared";

/**
 * One product in a grid. Image and name link to the product page; «Add to cart»
 * sits outside the links (a button inside a link is invalid HTML) and only
 * appears when the site's context resolves a price. A product that needs a
 * variant choice gets «Choose options» instead, a link to its picker.
 */
export function ProductCard({
  vm,
  code,
  price,
  onAdd,
  adding = false,
  chooseOptions = false,
}: {
  vm: ProductCardVM;
  /** The product's own `code`. `vm.code` falls back to the id, so it cannot tell. */
  code?: string | undefined;
  price?: PriceVM | undefined;
  onAdd?: (() => void) | undefined;
  adding?: boolean;
  /** A variant root or parent: it cannot go into the cart itself. */
  chooseOptions?: boolean;
}) {
  const href = `/product/${encodeURIComponent(vm.id)}`;
  return (
    <article className="pc">
      {/* The name below is the accessible link; this one is a larger click target. */}
      <Link to={href} className="pc__media" tabIndex={-1} aria-hidden="true">
        {vm.image ? <img src={vm.image} alt="" loading="lazy" /> : <span className="pc__ph">{initials(vm.name)}</span>}
      </Link>
      <div className="pc__meta">
        {code ? <span className="pc__code">Art. {code}</span> : null}
        <Link to={href} className="pc__name">
          {vm.name}
        </Link>
        {price ? (
          <span className="price pc__price">{money(price.amount, price.currency)}</span>
        ) : (
          <span className="pc__noprice">No price in this context</span>
        )}
        {chooseOptions ? (
          <Link to={href} className="btn btn--outline btn--sm pc__add" aria-label={`Choose options for ${vm.name}`}>
            Choose options
          </Link>
        ) : price && onAdd ? (
          <button type="button" className="btn btn--accent btn--sm pc__add" onClick={onAdd} disabled={adding}>
            Add to cart
          </button>
        ) : null}
      </div>
    </article>
  );
}

/** Up to two initials for the placeholder of a product without an image. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}
