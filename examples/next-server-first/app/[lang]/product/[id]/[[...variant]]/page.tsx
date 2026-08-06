import type { Metadata } from "next";
import Link from "next/link";
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

import { Note, Sheet } from "../../../../components/sheet";
import { pricesFor } from "../../../../lib/prices";
import { addToCart } from "../../../../actions/cart";
import { isLanguage } from "../../../../lib/languages";
import { jsonLdScript, productJsonLd } from "../../../../lib/json-ld";
import { alternatesFor } from "../../../../lib/seo";
import { SITE_NAME, absoluteUrl } from "../../../../lib/site-url";
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

/**
 * Free, measured. 2026-08-06 with a `diagnostics_channel` probe on
 * `undici:request:create`: a cold product page made four upstream calls with this
 * function present and four without it, and `GET /product/viu/products/<id>`
 * appeared exactly **once** although both this function and the page body ask for
 * it. Next memoizes identical fetches within a request, so no memo layer is needed
 * here — and if that ever changes, the probe is how you find out.
 *
 * **The canonical drops the variant segment.** `/de/product/x/anything` renders 200
 * today, and a self-referencing canonical would bless every one of those as its own
 * document. Every variant points at the parent instead: one line, no extra call, and
 * the right answer for near-identical variant pages regardless. It does not remove
 * the junk URLs — that needs the segment validation this demo has not done yet — it
 * stops them competing with the real one.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; id: string }>;
}): Promise<Metadata> {
  const { lang, id } = await params;
  if (!isLanguage(lang)) return {};
  const client = getEmporixClient({ context: await siteContext(lang), timeouts: TIMEOUTS });

  let product: Product;
  try {
    product = await client.products.get(id, undefined, undefined);
  } catch (e) {
    // The page renders `notFound()` for this same case a moment later. Returning the
    // empty object leaves the 404 page its own title instead of throwing twice.
    if (e instanceof EmporixNotFoundError) return {};
    throw e;
  }

  const name = productName(product);
  const description = stripHtml(pickText((product as { description?: unknown }).description, ""));
  // 160 characters is where search engines cut a description. Truncated at a word
  // boundary, and only when there is something to truncate.
  const short =
    description.length > 160 ? `${description.slice(0, 157).replace(/\s+\S*$/, "")}…` : description;

  return {
    title: name,
    ...(short !== "" ? { description: short } : {}),
    alternates: alternatesFor(lang, `/product/${encodeURIComponent(id)}`),
    openGraph: {
      type: "website",
      title: name,
      siteName: SITE_NAME,
      ...(short !== "" ? { description: short } : {}),
    },
  };
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
  //
  // More than one segment is not a variant URL. `/de/product/x/a/b/c` answered 200
  // before — measured 2026-08-06.
  if (variant !== undefined && variant.length > 1) notFound();
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

  let selected = children[0] ?? parent;
  if (chosen !== undefined) {
    const match = children.find((c) => (c as { id?: string }).id === chosen);
    // A variant segment that names nothing is not a document. On this tenant that is
    // *every* variant segment, because `children` is always empty — correct rather
    // than a regression: `/de/product/x/bogus` answered 200 before and was never a
    // page.
    //
    // A statement rather than `children.find(…) ?? notFound()`, although the latter
    // type-checks because `notFound()` returns `never`: every other guard in this file
    // is a statement, and a control-flow jump hidden inside a `??` is the kind of line
    // somebody reads twice.
    if (match === undefined) notFound();
    selected = match;
  }
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

  // The CANONICAL url, not the requested one: a variant page canonicalises to its parent,
  // and structured data claiming a different URL would be a second, contradicting
  // statement about the same document.
  const canonical = absoluteUrl(`/${lang}/product/${encodeURIComponent(id)}`);
  // `code` is the merchant code — `iam-jit-access` on this tenant. An Emporix product has
  // no `gtin`, `sku` or `ean` field, so this is what `sku` gets.
  const code = (parent as { code?: unknown }).code;
  const ld = productJsonLd({
    name,
    url: canonical,
    description,
    // Spread rather than `sku: undefined`: `exactOptionalPropertyTypes` is on in this
    // repo, so an explicit undefined is not assignable to an optional property.
    ...(typeof code === "string" ? { sku: code } : {}),
    ...(price !== undefined
      ? { price: { amount: price.amount, currency: price.currency } }
      : {}),
  });

  async function add(formData: FormData): Promise<void> {
    "use server";
    await addToCart(String(formData.get("productId")));
  }

  return (
    <main className="container pdp" style={{ paddingBlock: "var(--s-6)" }}>
      <script
        type="application/ld+json"
        // `jsonLdScript`, not `JSON.stringify`: merchant text in a script body needs `<`
        // escaped, or a description containing `</script>` closes the element.
        dangerouslySetInnerHTML={{ __html: jsonLdScript(ld) }}
      />
      <Sheet
        meta={{
          route: "/[lang]/product/[id]/[[...variant]]",
          render: "static",
          revalidate: 3600,
        }}
        rail={
          <>
            <Note title="Variant is a path">
              The chosen variant is a path segment, not <code>?variant=</code>.
              Reading <code>searchParams</code> would make this route dynamic, and a
              variant deserves its own cacheable, bookmarkable URL anyway.
            </Note>
            <Note title="Plain text description">
              storefront-demo renders the merchant&rsquo;s HTML. There is no{" "}
              <code>DOMParser</code> in Node, so this demo strips it instead of
              sanitising it — a server-first build has to say where its limits are.
            </Note>
          </>
        }
      >
        <p style={{ marginBottom: "var(--s-5)" }}>
          <Link href={`/${lang}`} className="eyebrow u-underline">
            ← Catalogue
          </Link>
        </p>
        {/* Two columns only when there is an image. No product on this tenant has
            one, and an empty 600px placeholder next to the details is worse than no
            image column at all. Each image sits in a `.pdp__hero` box: it has an
            `aspect-ratio`, so the box is there before the image and the layout shift is
            gone — which is why `next/image` is not missed here. */}
        <div className={images.length > 0 ? "pdp__grid" : ""}>
          {images.length > 0 ? (
            <div>
              {images.map((url, i) => (
                <div key={i} className="pdp__hero">
                  <img
                    src={url}
                    alt={name}
                    loading={i === 0 ? "eager" : "lazy"}
                    decoding="async"
                  />
                </div>
              ))}
            </div>
          ) : null}
          <div className="pdp__info">
            <h1 style={{ fontSize: "var(--step-2)" }}>{name}</h1>
            {price !== undefined ? (
              <p className="price" style={{ fontSize: "var(--step-1)", marginTop: "var(--s-4)" }}>
                {money(price.amount, price.currency)}
              </p>
            ) : (
              <p className="muted" style={{ marginTop: "var(--s-4)" }}>
                No price in this context — this product cannot be added to a cart.
              </p>
            )}
            {description !== "" ? (
              <p className="muted" style={{ marginTop: "var(--s-4)", maxWidth: "60ch" }}>
                {description}
              </p>
            ) : null}

            {children.length > 0 ? (
              <nav
                className="cluster"
                aria-label="Variants"
                style={{ gap: "var(--s-2)", marginTop: "var(--s-5)" }}
              >
                {children.map((c) => {
                  const cid = (c as { id?: string }).id ?? "";
                  return (
                    <Link
                      key={cid}
                      href={`/${lang}/product/${encodeURIComponent(id)}/${encodeURIComponent(cid)}`}
                      className={cid === selectedId ? "tag tag--accent" : "tag"}
                    >
                      {productName(c)}
                    </Link>
                  );
                })}
              </nav>
            ) : null}

            {price !== undefined ? (
              <form action={add} style={{ marginTop: "var(--s-5)" }}>
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
      </Sheet>
    </main>
  );
}
