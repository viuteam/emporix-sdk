import { useQuery } from "@tanstack/react-query";
import { useEmporix } from "@viu/emporix-sdk-react";
import { toProductCard } from "./adapters";

export interface ProductDetails {
  name: string;
  image?: string;
  /** The article number, when the product has one besides its id. */
  code?: string;
}

/**
 * Resolves name, image and article number by product id. Cart items carry only
 * an `itemYrn` (the cart GET returns an empty `product`), so cart and checkout
 * lines look them up here, in one `searchByIds` call.
 */
export function useProductDetails(productIds: string[]): Record<string, ProductDetails> {
  const { client } = useEmporix();
  const ids = Array.from(new Set(productIds.filter(Boolean))).sort();
  const { data } = useQuery({
    queryKey: ["demo", "product-details", client.tenant, ids],
    enabled: ids.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const products = await client.products.searchByIds(ids);
      const map: Record<string, ProductDetails> = {};
      for (const p of products) {
        const vm = toProductCard(p);
        if (!vm.id) continue;
        map[vm.id] = {
          name: vm.name,
          ...(vm.image ? { image: vm.image } : {}),
          ...(vm.code !== vm.id ? { code: vm.code } : {}),
        };
      }
      return map;
    },
  });
  return data ?? {};
}

/** Display names only, for the callers that need nothing else. */
export function useProductNames(productIds: string[]): Record<string, string> {
  const details = useProductDetails(productIds);
  return Object.fromEntries(Object.entries(details).map(([id, d]) => [id, d.name]));
}
