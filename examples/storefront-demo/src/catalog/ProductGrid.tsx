import type { Product } from "@viu/emporix-sdk";
import type { PriceVM } from "../lib/adapters";
import { isVariantParent, needsVariantChoice, toProductCard } from "../lib/adapters";
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
  const cards = products.map((p) => {
    const vm = toProductCard(p);
    // A variant root or parent is priced for the listing but not sellable — the
    // cart answers 400. Its card links to the picker instead.
    const choose = needsVariantChoice(p) || isVariantParent(p);
    return { vm, code: (p as { code?: string }).code, price: priceOf?.(vm.id), choose };
  });
  // ponytail: priced products first within what is loaded — a priced product on
  // a page not loaded yet does not move up. Upgrade path: match prices over more
  // than one page before sorting.
  cards.sort((a, b) => Number(!a.price) - Number(!b.price));
  return (
    <div className="product-grid">
      {cards.map(({ vm, code, price, choose }, i) => (
        <ProductCard
          key={vm.id || i}
          vm={vm}
          code={code}
          price={price}
          adding={isPending}
          chooseOptions={choose}
          {...(price && !choose ? { onAdd: () => void add(vm.id, vm.name, price, 1) } : {})}
        />
      ))}
    </div>
  );
}
