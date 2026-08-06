import type { MetadataRoute } from "next";
import { getEmporixClient } from "@viu/emporix-sdk-next";
import { categoryIndex } from "./lib/category-tree";
import { DEFAULT_LANGUAGE, LANGUAGES } from "./lib/languages";
import { siteContext } from "./lib/site-context";
import { absoluteUrl } from "./lib/site-url";
import { TIMEOUTS } from "./emporix";

/**
 * Every URL this storefront wants found, in both languages.
 *
 * The categories are free — `categoryIndex` is already cached under the
 * `emporix:categories` tag for the category pages, so this route reads the same entry
 * rather than asking Emporix again. On the `viu` tenant that is 1'631 categories and
 * 876 products, so 5'018 URLs across both languages — comfortably inside the 50'000
 * per sitemap the protocol allows.
 *
 * `revalidate` matches the catalog routes. Without it the sitemap would be built
 * once and then keep a category tree that has moved on.
 *
 * The URLs are **absolute**, built by `absoluteUrl`. The sitemaps protocol requires
 * it, and a crawler that reads it strictly drops a relative entry rather than
 * guessing the host.
 */
export const revalidate = 3600;

const PAGE = 200;

/**
 * The largest catalogue this sitemap will emit as a single file.
 *
 * A sitemap holds at most 50'000 URLs. With two languages and the categories already
 * taking 3'262 of them, that leaves room for roughly 23'000 products — so 20'000 is a
 * bound with headroom rather than a guess. Hitting it means it is time for
 * `generateSitemaps` and shards, which is why it says so out loud instead of silently
 * truncating.
 */
const MAX_PRODUCTS = 20_000;

/**
 * Every product id, once, with the timestamp the sitemap reports.
 *
 * **One walk for both languages**, because a product URL differs only in its prefix —
 * the ids and `modifiedAt` are language-independent. Walking per language would double
 * the Emporix calls for identical data.
 *
 * Measured 2026-08-06: 876 products, so five pages of 200. Each page is a tagged GET
 * (`emporix:products`), so the walk is cached for an hour and the product webhook
 * invalidates it along with everything else.
 */
async function allProducts(): Promise<{ id: string; modifiedAt?: string }[]> {
  const client = getEmporixClient({
    // Any language does: this reads ids and timestamps, neither of which is localized.
    context: await siteContext(DEFAULT_LANGUAGE),
    timeouts: TIMEOUTS,
  });
  const out: { id: string; modifiedAt?: string }[] = [];
  for (let page = 1; out.length < MAX_PRODUCTS; page += 1) {
    // `undefined` for auth, matching `categoryTree` in this app: the SDK defaults to an
    // anonymous context and the tagged client is the one holding the token.
    const res = await client.products.list({ pageSize: PAGE, pageNumber: page }, undefined);
    for (const p of res.items) {
      const id = (p as { id?: string }).id;
      if (id === undefined || id === "") continue;
      const modifiedAt = (p as { metadata?: { modifiedAt?: string } }).metadata?.modifiedAt;
      out.push(modifiedAt !== undefined ? { id, modifiedAt } : { id });
    }
    if (res.items.length < PAGE) return out;
  }
  console.warn(
    `sitemap: stopped at ${MAX_PRODUCTS} products. Shard with generateSitemaps — one file holds 50'000 URLs.`,
  );
  return out;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [];
  // Outside the language loop on purpose — see `allProducts`.
  const products = await allProducts();

  for (const lang of LANGUAGES) {
    const { byId } = await categoryIndex(lang);
    entries.push(
      { url: absoluteUrl(`/${lang}`), changeFrequency: "daily", priority: 1 },
      { url: absoluteUrl(`/${lang}/categories`), changeFrequency: "weekly", priority: 0.8 },
    );
    for (const id of Object.keys(byId)) {
      // Page one has no segment, so this is the same URL the category page's own
      // links use — one entry per category, not two.
      entries.push({
        url: absoluteUrl(`/${lang}/category/${encodeURIComponent(id)}`),
        changeFrequency: "weekly",
        priority: 0.6,
      });
    }
    for (const p of products) {
      entries.push({
        url: absoluteUrl(`/${lang}/product/${encodeURIComponent(p.id)}`),
        ...(p.modifiedAt !== undefined ? { lastModified: new Date(p.modifiedAt) } : {}),
        changeFrequency: "weekly",
        priority: 0.7,
      });
    }
  }

  return entries;
}
