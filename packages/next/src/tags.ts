/**
 * Cache-tag vocabulary and the URL→tag mapping.
 *
 * Tags are derived from the request URL rather than passed per call because the
 * SDK has 596 `http.request({...})` call sites, each building its own options
 * literal — a per-call tag would be forgotten somewhere. Deriving centrally
 * makes that impossible.
 */

/** Tag constructors. Keep these stable: they are what `revalidateTag` receives. */
export const emporixTags = {
  product: (id: string): string => `emporix:product:${id}`,
  products: "emporix:products",
  category: (id: string): string => `emporix:category:${id}`,
  categories: "emporix:categories",
  categoryTree: (id: string): string => `emporix:category-tree:${id}`,
  prices: "emporix:prices",
  availability: "emporix:availability",
  sites: "emporix:sites",
} as const;

/**
 * Path segments that appear where an id would and are NOT ids.
 * All real: `/products/bulk`, `/products/search`, `/products/recalculate`,
 * `/products/recalculate/jobs`, `/categories/search`, `/category-trees/search`.
 * Without this, the mapper emits `emporix:product:bulk`.
 */
const RESERVED = new Set(["bulk", "search", "recalculate", "jobs"]);

/** `undefined` or a reserved word means "this is the collection, not an item". */
function itemId(segment: string | undefined): string | null {
  if (segment === undefined || RESERVED.has(segment)) return null;
  return decodeURIComponent(segment);
}

/**
 * Maps an Emporix API URL to the Next cache tags its response should carry.
 * Returns `[]` for anything not safe to cache — a different tenant, a
 * non-catalog service, a personalized resource, or an unparseable URL.
 *
 * Cart, order, customer and token endpoints intentionally return `[]`: they are
 * either mutable per shopper or secret.
 */
export function emporixTagsForUrl(url: string, tenant: string): string[] {
  let segments: string[];
  try {
    segments = new URL(url).pathname.split("/").filter((s) => s.length > 0);
  } catch {
    return [];
  }
  const [service, urlTenant, collection, third] = segments;
  if (urlTenant !== tenant) return [];

  switch (service) {
    case "product": {
      if (collection !== "products") return [];
      const id = itemId(third);
      return id === null
        ? [emporixTags.products]
        : [emporixTags.product(id), emporixTags.products];
    }
    case "category": {
      if (collection === "categories") {
        const id = itemId(third);
        return id === null
          ? [emporixTags.categories]
          : [emporixTags.category(id), emporixTags.categories];
      }
      if (collection === "category-trees") {
        const id = itemId(third);
        return id === null
          ? [emporixTags.categories]
          : [emporixTags.categoryTree(id), emporixTags.categories];
      }
      return [];
    }
    case "price":
      return [emporixTags.prices];
    case "availability":
      return [emporixTags.availability];
    case "site":
      return [emporixTags.sites];
    default:
      return [];
  }
}
