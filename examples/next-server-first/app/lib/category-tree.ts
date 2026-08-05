import { unstable_cache } from "next/cache";
import type { CategoryNode } from "@viu/emporix-sdk";
import { getEmporixClient } from "@viu/emporix-sdk-next";
import { siteContext } from "./site-context";
import { TIMEOUTS } from "../emporix";
import { buildIndex, type CategoryIndex } from "./category-index";

/**
 * Every category the tenant has, nested — in one cached call.
 *
 * `GET /category-trees` maps to the `emporix:categories` cache tag
 * (`packages/next/src/tags.ts`), so this is cached for an hour and the webhook
 * route invalidates it on `category.*`. Nothing extra is needed for freshness.
 *
 * It is the only source of hierarchy that works. Measured against `viu` on
 * 2026-08-04: `categories.subcategories(id)` reads assignments filtered to
 * `ref.type === "CATEGORY"` and was empty for every category tried,
 * `categories.childCategories(id)` answers 404 for a tree root, and
 * `categories.parents(id)` answers 404 for a root. The children come inline here
 * instead.
 *
 * On that tenant it returns 21 roots and 1'631 nodes — the same count as the flat
 * `categories.list()` — for 378 KiB and 282 ms on a cache miss.
 *
 * The flattening lives in `category-index.ts`, which has no runtime imports that
 * reach the server so vitest can load it. This file cannot be tested:
 * `siteContext` pulls in the server-only session entry.
 */
export async function categoryTree(lang?: string): Promise<CategoryNode[]> {
  // The language is passed in, never read from the session here. A cookie read
  // inside this helper made every page that calls it dynamic — including the
  // two catalog routes that exist to be cached.
  const client = getEmporixClient({ context: await siteContext(lang), timeouts: TIMEOUTS });
  return client.categories.tree(undefined);
}

/**
 * The flattened index for one language, cached for an hour.
 *
 * Two caches stack here and they cover different things: the SDK's tagged fetch
 * keeps the 378 KiB tree out of the network, this keeps the parse and the walk
 * out of the render.
 *
 * Since the catalog routes went to ISR this is no longer a per-request saving —
 * a render only happens on a cache miss. It is a per-miss one, shared across
 * every category path and both listing pages within the window. Worth having,
 * smaller than it would have been before `/[lang]/…`.
 *
 * `emporix:categories` is the tag the webhook already revalidates, so a category
 * change invalidates this along with the tree it was built from.
 */
export const categoryIndex = unstable_cache(
  async (lang: string): Promise<CategoryIndex> => buildIndex(await categoryTree(lang)),
  ["emporix-category-index"],
  { revalidate: 3600, tags: ["emporix:categories"] },
);
