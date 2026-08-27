/**
 * What is left after the package grew up.
 *
 * This file used to hold every Emporix read the storefront makes, because
 * `@viu/emporix-sdk-angular` shipped only the foundation. It now ships the 33
 * injectables, so the components call those directly and this is down to the one
 * read the package has no injectable for.
 *
 * Keeping it is the honest signal: a storefront still needs a lookup the bindings
 * do not cover, and pretending otherwise would hide that from the next reader.
 */
import type { Signal } from "@angular/core";
import { injectEmporix, injectEmporixQuery } from "@viu/emporix-sdk-angular";
import { productName } from "@viu/emporix-examples-shared";

/**
 * Display names for cart lines.
 *
 * A cart item carries only an `itemYrn`, no product details, so a line whose
 * stored snapshot has no name renders blank without this. One bulk read, keyed on
 * the sorted id set so two carts with the same products share the entry.
 *
 * No package equivalent yet: `products.searchByIds` is a bulk lookup rather than a
 * storefront read, and the 33 are the storefront cut.
 */
export function productNamesQuery(productIds: Signal<readonly string[]>) {
  const { client } = injectEmporix();
  return injectEmporixQuery<Record<string, string>, readonly [string]>(() => {
    const ids = [...new Set(productIds().filter(Boolean))].sort();
    return {
      resource: "product-names",
      args: [ids.join(",")] as const,
      site: "language",
      mode: "read-auth",
      enabled: ids.length > 0,
      queryFn: async (ctx) => {
        const products = await client.products.searchByIds(ids, undefined, ctx);
        const map: Record<string, string> = {};
        for (const p of products) {
          const id = (p as { id?: string }).id;
          if (id !== undefined) map[id] = productName(p);
        }
        return map;
      },
      staleTime: 5 * 60_000,
    };
  });
}
