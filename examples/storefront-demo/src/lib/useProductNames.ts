import { useQuery } from "@tanstack/react-query";
import { useEmporix } from "@viu/emporix-sdk-react";
import { productName } from "./adapters";

/**
 * Resolves product display names by id. Cart items carry only an `itemYrn`
 * (no product details), so cart/checkout lines look names up here.
 */
export function useProductNames(productIds: string[]): Record<string, string> {
  const { client } = useEmporix();
  const ids = Array.from(new Set(productIds.filter(Boolean))).sort();
  const { data } = useQuery({
    queryKey: ["demo", "product-names", client.tenant, ids],
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const products = await client.products.searchByIds(ids);
      const map: Record<string, string> = {};
      for (const p of products) {
        const id = (p as { id?: string }).id;
        if (id) map[id] = productName(p);
      }
      return map;
    },
  });
  return data ?? {};
}
