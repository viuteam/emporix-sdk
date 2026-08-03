import type { Product } from "@viu/emporix-sdk";
import { money, toProductCard, type PriceVM } from "@viu/emporix-examples-shared";
import { addToCart } from "../actions/cart";

/**
 * A Server Component. The class names come from the CSS copied out of
 * storefront-demo, so the two demos look alike without sharing a file.
 *
 * «Add to cart» is a real `<form>` posting to a Server Action, not a button with
 * an onClick — which is why this file needs no `"use client"` and works with
 * JavaScript disabled.
 */
export function ProductGrid({
  products,
  priceOf,
}: {
  products: Product[];
  priceOf: (id: string) => PriceVM | undefined;
}): React.JSX.Element {
  async function add(formData: FormData): Promise<void> {
    "use server";
    await addToCart(String(formData.get("productId")));
  }

  return (
    <ul className="grid" style={{ listStyle: "none", padding: 0 }}>
      {products.map((p) => {
        const vm = toProductCard(p);
        const price = priceOf(vm.id);
        return (
          <li key={vm.id} className="pc">
            <a href={`/product/${encodeURIComponent(vm.id)}`}>
              {vm.image !== undefined ? (
                <img src={vm.image} alt={vm.imageAlt} style={{ maxWidth: "100%" }} />
              ) : (
                <div className="pc__ph" />
              )}
              <span className="serif" style={{ display: "block", marginTop: "var(--s-2)" }}>
                {vm.name}
              </span>
            </a>
            {price !== undefined ? (
              <p className="price">{money(price.amount, price.currency)}</p>
            ) : (
              // Not every product is priced, and a product without a price cannot
              // be added — Emporix requires a `priceId` on internal cart items.
              <p className="muted">no price in this context</p>
            )}
            {price !== undefined ? (
              <form action={add}>
                <input type="hidden" name="productId" value={vm.id} />
                <button type="submit" className="btn btn--sm">
                  Add to cart
                </button>
              </form>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
