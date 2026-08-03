import type { AuthContext, EmporixClient } from "@viu/emporix-sdk";
import { productName } from "@viu/emporix-examples-shared";

/**
 * Display names by product id.
 *
 * Cart lines carry only an `itemYrn`: the cart GET returns an **empty** `product`
 * object, so there is no name in the answer and it has to be fetched separately.
 * The server-side counterpart to storefront-demo's `useProductNames`, which
 * exists for exactly the same reason.
 *
 * One `searchByIds` for the whole cart, deduplicated — a name per line would be
 * one request per line.
 */
export async function namesFor(
  client: EmporixClient,
  auth: AuthContext | undefined,
  ids: string[],
): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((x) => x !== ""))];
  if (unique.length === 0) return {};
  const products = await client.products.searchByIds(unique, {}, auth);
  const map: Record<string, string> = {};
  for (const p of products) {
    const id = (p as { id?: string }).id;
    if (id !== undefined) map[id] = productName(p);
  }
  return map;
}
