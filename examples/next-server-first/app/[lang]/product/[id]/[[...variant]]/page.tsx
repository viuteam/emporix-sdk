import { notFound } from "next/navigation";
import { getEmporixClient } from "@viu/emporix-sdk-next";
import { EmporixNotFoundError, type Product } from "@viu/emporix-sdk";
import {
  imageOf,
  money,
  pickText,
  productImages,
  productName,
  stripHtml,
} from "@viu/emporix-examples-shared";

import { pricesFor } from "../../../../lib/prices";
import { addToCart } from "../../../../actions/cart";
import { siteContext } from "../../../../lib/site-context";
import { TIMEOUTS } from "../../../../emporix";

/**
 * A product page whose whole state lives in the URL.
 *
 * The variant choice is `?variant=<childId>`, so a picked variant is shareable and
 * survives a reload. storefront-demo's `VariantPicker` holds it in a hook; here
 * each variant is a link and the page re-renders on the server.
 */
export const revalidate = 3600;

/**
 * Empty on purpose, and load-bearing.
 *
 * A dynamic segment with **no** `generateStaticParams` is rendered on demand and
 * NOT cached — verified against `next start`: the route answered
 * `Cache-Control: private, no-cache, no-store` and `revalidate` was ignored.
 * Returning an empty list says «prerender nothing, but treat every path as
 * cacheable», which is ISR for a catalogue too large to enumerate at build time
 * (1'631 categories on this tenant).
 */
export function generateStaticParams(): { id: string }[] {
  return [];
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ lang: string; id: string; variant?: string[] }>;
}): Promise<React.JSX.Element> {
  const { lang, id, variant } = await params;
  // The chosen variant is a PATH segment, not `?variant=`: `searchParams` would
  // make this route dynamic, and a variant is a document worth its own cacheable
  // URL anyway — bookmarkable, crawlable, one cache entry each.
  const chosen = variant?.[0];
  const client = getEmporixClient({ context: await siteContext(lang), timeouts: TIMEOUTS });

  // An unknown id must be a 404, not a 500. A product URL outlives the product:
  // it sits in bookmarks, in search indexes and in other people's links, so this
  // is the ordinary case rather than the exotic one.
  let parent: Product;
  try {
    parent = await client.products.get(id, undefined, undefined);
  } catch (e) {
    if (e instanceof EmporixNotFoundError) notFound();
    throw e;
  }
  // Empty unless the product is a PARENT_VARIANT — and on the `viu` tenant that is
  // never: 300 products swept on 2026-08-03, every one `productType: BASIC`. The
  // variant nav below is therefore unexercised here, kept for tenants that do use
  // variants.
  //
  // Asked unconditionally: one wasted request on a plain product is cheaper than
  // type-narrowing the five shapes of Emporix's Product union to find out first.
  const children = await client.products.listVariantChildren(id, { pageSize: 50 }, undefined);

  const selected = children.find((c) => (c as { id?: string }).id === chosen) ?? children[0] ?? parent;
  const selectedId = (selected as { id?: string }).id ?? id;

  const priceOf = await pricesFor(client, undefined, [selected]);
  const price = priceOf(selectedId);
  const name = productName(parent);
  // stripHtml, not sanitizeHtml: there is no `DOMParser` in Node, so this demo
  // shows plain text where storefront-demo renders markup. See the README.
  const description = stripHtml(pickText((parent as { description?: unknown }).description, ""));
  const images = productImages(parent)
    .map((m) => imageOf([m]))
    .filter((u): u is string => u !== undefined);

  async function add(formData: FormData): Promise<void> {
    "use server";
    await addToCart(String(formData.get("productId")));
  }

  return (
    <main className="container pdp" style={{ paddingBlock: "var(--s-6)" }}>
      <p style={{ marginBottom: "var(--s-5)" }}>
        <a href={`/${lang}`} className="eyebrow u-underline">
          ← Catalogue
        </a>
      </p>
      {/* Zwei Spalten nur, wenn es ein Bild gibt. Kein Produkt dieses Tenants hat
          eines, und ein leerer 600px-Platzhalter neben den Angaben ist schlechter
          als gar keine Bildspalte. Jedes Bild sitzt in einer `.pdp__hero`-Box: die
          hat ein `aspect-ratio`, steht also vor dem Bild und nimmt den
          Layout-Sprung weg — der Grund, warum hier kein `next/image` fehlt. */}
      <div className={images.length > 0 ? "pdp__grid" : ""}>
        {images.length > 0 ? (
          <div>
            {images.map((url, i) => (
              <div key={i} className="pdp__hero">
                <img src={url} alt={name} loading={i === 0 ? "eager" : "lazy"} decoding="async" />
              </div>
            ))}
          </div>
        ) : null}
        <div className="pdp__info">
          <h1 className="serif" style={{ fontSize: "var(--step-3)" }}>
            {name}
          </h1>
          {price !== undefined ? (
            <p className="price" style={{ fontSize: "var(--step-2)", marginTop: "var(--s-3)" }}>
              {money(price.amount, price.currency)}
            </p>
          ) : (
            <p className="muted" style={{ marginTop: "var(--s-3)" }}>
              No price in this context — this product cannot be added to a cart.
            </p>
          )}
          {description !== "" ? (
            <p className="muted" style={{ marginTop: "var(--s-4)", maxWidth: "52ch" }}>
              {description}
            </p>
          ) : null}

          {children.length > 0 ? (
            <nav className="cluster" aria-label="Variants" style={{ gap: "var(--s-2)", marginTop: "var(--s-4)" }}>
              {children.map((c) => {
                const cid = (c as { id?: string }).id ?? "";
                return (
                  <a
                    key={cid}
                    href={`/${lang}/product/${encodeURIComponent(id)}/${encodeURIComponent(cid)}`}
                    className={cid === selectedId ? "tag tag--accent" : "tag"}
                  >
                    {productName(c)}
                  </a>
                );
              })}
            </nav>
          ) : null}

          {price !== undefined ? (
            <form action={add} style={{ marginTop: "var(--s-4)" }}>
              {/* The SELECTED id, which is a variant's when one is picked: a
                  PARENT_VARIANT is not orderable. */}
              <input type="hidden" name="productId" value={selectedId} />
              <button type="submit" className="btn btn--accent">
                Add to cart
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </main>
  );
}
