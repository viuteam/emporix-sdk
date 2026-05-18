"use client";

import { useState } from "react";
import { useCart, useCartMutations } from "@viu/emporix-sdk-react";

export default function CartPage(): React.JSX.Element {
  const [cartId, setCartId] = useState<string | undefined>(undefined);
  const cart = useCart(cartId);
  const { addItem } = useCartMutations(cartId ?? "");
  return (
    <main>
      <h1>Cart</h1>
      <input placeholder="cart id" onChange={(e) => setCartId(e.target.value || undefined)} />
      <p>{cart.data ? `${cart.data.items?.length ?? 0} items` : "no cart"}</p>
      <button
        disabled={!cartId}
        onClick={() => addItem.mutate({ productId: "demo", quantity: 1 })}
      >
        Add demo item
      </button>
    </main>
  );
}
