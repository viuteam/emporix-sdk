import type { MetadataRoute } from "next";
import { categoryIndex } from "./lib/category-tree";
import { LANGUAGES } from "./lib/languages";
import { absoluteUrl } from "./lib/site-url";

/**
 * Every URL this storefront wants found, in both languages.
 *
 * **Products are deliberately missing.** They need paging through the catalogue,
 * which is its own piece of work; the categories are free — `categoryIndex` is
 * already cached under the `emporix:categories` tag for the category pages, so this
 * route reads the same entry rather than asking Emporix again. On the `viu` tenant
 * that is 1'631 categories, so 3'266 URLs with the two entry pages per language —
 * comfortably inside the 50'000 per sitemap the protocol allows.
 *
 * `revalidate` matches the catalog routes. Without it the sitemap would be built
 * once and then keep a category tree that has moved on.
 *
 * The URLs are **absolute**, built by `absoluteUrl`. The sitemaps protocol requires
 * it, and a crawler that reads it strictly drops a relative entry rather than
 * guessing the host.
 */
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [];

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
  }

  return entries;
}
