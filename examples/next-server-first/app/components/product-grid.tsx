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
 * Das ist auch der Grund, warum die Karte anders aufgebaut ist als
 * storefront-demo's `ProductCard`: dort traegt das `<a>` die `.pc`-Klasse und die
 * ganze Karte ist ein Link. Ein `<form>` darf nicht in einem `<a>` stehen, also
 * sitzt `.pc` hier auf dem `<li>`, der Link umfasst Bild und Name, und das
 * Formular ist ein Geschwister mit `margin-top: auto`.
 *
 * Die «no. 01»-Nummerierung von storefront-demo ist bewusst nicht uebernommen: ein
 * Produktraster ist keine Reihenfolge, die Nummer wuerde nichts kodieren.
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
          // `reveal` staffelt den Seitenaufbau; `--i` ist der Platz in der Reihe.
          // global.css schaltet die Animation bei `prefers-reduced-motion` ab.
          <li key={vm.id} className="pc reveal" style={{ "--i": i % 12 } as CSSProperties}>
            <a href={`/${lang}/product/${encodeURIComponent(vm.id)}`}>
              <div className="pc__media">
                {vm.image !== undefined ? (
                  // Kein `next/image`: Emporix-Medien liegen auf einem
                  // Storage-Host, der in `images.remotePatterns` stehen muesste,
                  // und kein Produkt, das diese Demo laedt, hat ueberhaupt ein
                  // Bild — die Konfiguration waere unverifizierbar. Der
                  // Layout-Sprung, den next/image loesen wuerde, ist hier ohnehin
                  // weg: `.pc__media` hat ein `aspect-ratio`, die Box steht vor
                  // dem Bild.
                  // ponytail: next/image sobald der Storage-Host des Tenants
                  // belegt ist und ein Produkt ein Bild hat.
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
            </a>
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
