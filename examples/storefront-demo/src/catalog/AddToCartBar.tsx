import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PriceVM } from "../lib/adapters";
import { Button } from "../components/ui/Button";
import { useAddToCart } from "./useAddToCart";

export function AddToCartBar({
  productId,
  productName,
  price,
  blockedHint,
}: {
  productId: string;
  productName: string;
  price?: PriceVM | undefined;
  /** Set when this product cannot go into the cart as it is, e.g. a variant still has to be chosen. */
  blockedHint?: string | undefined;
}) {
  const { add, isPending } = useAddToCart();
  const nav = useNavigate();
  const [qty, setQty] = useState(1);
  // Emporix requires a priceId on internal-type cart items — only priced products
  // are purchasable. Say so instead of letting the API answer 400.
  const purchasable = Boolean(price?.priceId) && !blockedHint;

  return (
    <div className="buy-bar">
      <div className="cluster">
        <div className="qty" role="group" aria-label="Quantity">
          <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease">
            –
          </button>
          <span aria-live="polite">{qty}</span>
          <button type="button" onClick={() => setQty((q) => q + 1)} aria-label="Increase">
            +
          </button>
        </div>
        <Button
          variant="accent"
          onClick={() => {
            if (price) void add(productId, productName, price, qty);
          }}
          disabled={!purchasable || isPending}
        >
          {isPending ? "Adding…" : "Add to cart"}
        </Button>
        <Button variant="ghost" onClick={() => nav("/cart")}>
          View cart →
        </Button>
      </div>
      {blockedHint ? (
        <p className="muted buy-bar__hint">{blockedHint}</p>
      ) : !purchasable ? (
        <p className="muted buy-bar__hint">
          No price for this product on the selected site. Prices depend on the site chosen in the setup.
        </p>
      ) : null}
    </div>
  );
}
