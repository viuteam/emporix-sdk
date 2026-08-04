import type { CategoryNode } from "@viu/emporix-sdk";
import { getEmporixClient } from "@viu/emporix-sdk-next";
import { siteContext } from "./site-context";

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
 * The walk over the result is in `category-walk.ts`, which has no runtime imports
 * so vitest can load it. This file cannot be tested: `siteContext` pulls in the
 * server-only session entry.
 */
export async function categoryTree(): Promise<CategoryNode[]> {
  const client = getEmporixClient({ context: await siteContext() });
  return client.categories.tree(undefined);
}
