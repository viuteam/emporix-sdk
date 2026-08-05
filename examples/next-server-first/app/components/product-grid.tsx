import Link from "next/link";
import type { CSSProperties } from "react";
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
 *
 * That is also why the card is built differently from storefront-demo's
 * `ProductCard`: there the `<a>` carries the `.pc` class and the whole card is one
 * link. A `<form>` may not sit inside an `<a>`, so `.pc` lives on the `<li>` here,
 * the link wraps image and name, and the form is a sibling with `margin-top: auto`.
 *
 * storefront-demo's «no. 01» numbering is deliberately not carried over: a product
 * grid is not a sequence, so the number would encode nothing.
 */
export function ProductGrid({
  products,
  priceOf,
  lang,
}: {
  products: Product[];
  priceOf: (id: string) => PriceVM | undefined;
  /** Prefix for the product links — catalog routes live under `/[lang]/…`. */
  lang: string;
}): React.JSX.Element {
  async function add(formData: FormData): Promise<void> {
    "use server";
    await addToCart(String(formData.get("productId")));
  }

  return (
    <ul className="product-grid" style={{ listStyle: "none", padding: 0 }}>
      {products.map((p, i) => {
        const vm = toProductCard(p);
        const price = priceOf(vm.id);
        return (
          // `reveal` staggers the page build-up; `--i` is the position in the row.
          // global.css turns the animation off under `prefers-reduced-motion`.
          <li key={vm.id} className="pc reveal" style={{ "--i": i % 12 } as CSSProperties}>
            {/* `prefetch={false}`, and that is a cost decision.
                `/[lang]/product/[id]` carries an empty `generateStaticParams`, so it is
                cacheable but not prebuilt: the first request for a URL renders in full
                and costs `products.get` + `listVariantChildren` + `pricesFor`. At 24
                tiles that would be roughly 70 Emporix calls for products nobody clicks
                — and Emporix bills per call. The header link and the pagination do keep
                prefetching: few targets, high click-through. */}
            <Link href={`/${lang}/product/${encodeURIComponent(vm.id)}`} prefetch={false}>
              <div className="pc__media">
                {vm.image !== undefined ? (
                  // No `next/image`: Emporix media sit on a storage host that would
                  // have to be listed in `images.remotePatterns`, and no product this
                  // demo loads has an image at all — the config would be
                  // unverifiable. The layout shift next/image would solve is gone
                  // anyway: `.pc__media` has an `aspect-ratio`, so the box is there
                  // before the image is.
                  // ponytail: next/image once the tenant's storage host is confirmed
                  // and some product actually has an image.
                  <img src={vm.image} alt={vm.imageAlt} loading="lazy" decoding="async" />
                ) : (
                  <div className="pc__ph" />
                )}
              </div>
              <div className="pc__meta">
                <span className="pc__name">
                  <span className="u-underline">{vm.name}</span>
                </span>
                {price !== undefined ? (
                  <span className="price pc__price">{money(price.amount, price.currency)}</span>
                ) : (
                  // Not every product is priced, and a product without a price cannot
                  // be added — Emporix requires a `priceId` on internal cart items.
                  <span className="muted pc__price">no price in this context</span>
                )}
              </div>
            </Link>
            {price !== undefined ? (
              <form action={add} className="pc__action">
                <input type="hidden" name="productId" value={vm.id} />
                <button type="submit" className="btn btn--sm btn--outline">
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
