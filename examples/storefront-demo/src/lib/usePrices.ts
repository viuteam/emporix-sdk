import { useMatchPrices } from "@viu/emporix-sdk-react";
import type { Product } from "@viu/emporix-sdk";
import { priceMatchItems, priceForProduct, type PriceVM } from "./adapters";

/**
 * Best-effort price lookup for a set of products via `matchByContext`. Prices
 * resolve only when the anonymous session has a pricing context (site/currency)
 * — set those in the setup screen's Advanced section. Returns a lookup fn;
 * missing prices simply render as nothing.
 */
export function usePrices(products: Product[]): (productId: string) => PriceVM | undefined {
  const items = priceMatchItems(products);
  const { data } = useMatchPrices({ items }, { enabled: items.length > 0 });
  return (productId: string) => priceForProduct(data, productId);
}
