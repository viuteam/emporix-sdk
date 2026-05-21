"use client";

import { useActiveCart, useCartMutations } from "@viu/emporix-sdk-react";

export default function CartPage(): React.JSX.Element {
  const cart = useActiveCart({ create: true });
  const { addItem } = useCartMutations();
  return (
    <main>
      <h1>Cart</h1>
      <p>{cart.data ? `${cart.data.items?.length ?? 0} items` : "no cart"}</p>
      <button
        disabled={!cart.data?.id}
        onClick={() =>
          addItem.mutate({
            product: { id: "demo" },
            quantity: 1,
            price: { priceId: "demo", originalAmount: 0, effectiveAmount: 0, currency: "EUR" },
          })
        }
      >
        Add demo item
      </button>
    </main>
  );
}
