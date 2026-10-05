import type { Product } from "@viu/emporix-sdk";
import type { PriceVM } from "../lib/adapters";
import { toProductCard } from "../lib/adapters";
import { ProductCard } from "./ProductCard";
import { useAddToCart } from "./useAddToCart";

export function ProductGrid({
  products,
  priceOf,
}: {
  products: Product[];
  priceOf?: ((id: string) => PriceVM | undefined) | undefined;
}) {
  // One hook for the whole grid; see useAddToCart for why not one per card.
  const { add, isPending } = useAddToCart();
  const cards = products.map(toProductCard).map((vm) => ({ vm, price: priceOf?.(vm.id) }));
  // ponytail: priced products first within what is loaded — a priced product on
  // a page not loaded yet does not move up. Upgrade path: match prices over more
  // than one page before sorting.
  cards.sort((a, b) => Number(!a.price) - Number(!b.price));
  return (
    <div className="product-grid">
      {cards.map(({ vm, price }, i) => (
        <ProductCard
          key={vm.id || i}
          vm={vm}
          price={price}
          adding={isPending}
          {...(price ? { onAdd: () => void add(vm.id, vm.name, price, 1) } : {})}
        />
      ))}
    </div>
  );
}
