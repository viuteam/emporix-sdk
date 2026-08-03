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

import { pricesFor } from "../../lib/prices";
import { addToCart } from "../../actions/cart";
import { siteContext } from "../../lib/site-context";

/**
 * A product page whose whole state lives in the URL.
 *
 * The variant choice is `?variant=<childId>`, so a picked variant is shareable and
 * survives a reload. storefront-demo's `VariantPicker` holds it in a hook; here
 * each variant is a link and the page re-renders on the server.
 */
export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ variant?: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const chosen = (await searchParams).variant;
  const client = getEmporixClient({ context: await siteContext() });

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

  async function add(formData: FormData): Promise<void> {
    "use server";
    await addToCart(String(formData.get("productId")));
  }

  return (
    <main className="container pdp" style={{ paddingBlock: "var(--s-6)" }}>
      <p style={{ marginBottom: "var(--s-5)" }}>
        <a href="/" className="eyebrow u-underline">
          ← Catalogue
        </a>
      </p>
      <div className="pdp__grid">
        <div>
          {productImages(parent).map((m, i) => {
            const url = imageOf([m]);
            return url === undefined ? null : (
              <img key={i} src={url} alt={name} style={{ maxWidth: "100%" }} />
            );
          })}
        </div>
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
                    href={`/product/${encodeURIComponent(id)}?variant=${encodeURIComponent(cid)}`}
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
