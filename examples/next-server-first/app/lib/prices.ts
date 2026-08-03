import type { AuthContext, EmporixClient, Product } from "@viu/emporix-sdk";
import { priceForProduct, priceMatchItems, type PriceVM } from "@viu/emporix-examples-shared";

/**
 * Resolves the prices for a set of products in ONE call and hands back a lookup.
 *
 * The server-side counterpart to storefront-demo's `usePrices` — same logic, no
 * React Query. One call per page rather than one per product: `matchByContext`
 * takes the whole set, and a price per product would be N requests per render.
 */
export async function pricesFor(
  client: EmporixClient,
  auth: AuthContext | undefined,
  products: Product[],
): Promise<(id: string) => PriceVM | undefined> {
  const items = priceMatchItems(products);
  if (items.length === 0) return () => undefined;
  const matches = await client.prices.matchByContext({ items }, auth);
  return (id) => priceForProduct(matches, id);
}
