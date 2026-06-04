import type { Product } from "@viu/emporix-sdk";
import type { PriceVM } from "../lib/adapters";
import { toProductCard } from "../lib/adapters";
import { ProductCard } from "./ProductCard";

export function ProductGrid({
  products,
  priceOf,
  lead = false,
}: {
  products: Product[];
  priceOf?: ((id: string) => PriceVM | undefined) | undefined;
  lead?: boolean;
}) {
  return (
    <div className="product-grid">
      {products.map((p, i) => {
        const vm = toProductCard(p);
        const price = priceOf ? priceOf(vm.id) : undefined;
        return (
          <ProductCard
            key={vm.id || i}
            vm={vm}
            index={i}
            lead={lead && i === 0}
            {...(price ? { price } : {})}
          />
        );
      })}
    </div>
  );
}
