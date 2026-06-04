import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useActiveCart, useCartMutations, useEmporix } from "@viu/emporix-sdk-react";
import { productYrn, type PriceVM } from "../lib/adapters";
import { Button } from "../components/ui/Button";
import { useToast, errorMessage } from "../app/Toasts";

export function AddToCartBar({
  productId,
  productName,
  price,
}: {
  productId: string;
  productName: string;
  price?: PriceVM | undefined;
}) {
  const { client } = useEmporix();
  const { data: cart } = useActiveCart({ create: true });
  const cartId = (cart as { id?: string } | null)?.id;
  const { addItem } = useCartMutations(cartId);
  const { notify } = useToast();
  const nav = useNavigate();
  const [qty, setQty] = useState(1);

  // Emporix requires a priceId on internal-type cart items — so only priced
  // products are purchasable. Surface that instead of letting the API 400.
  const purchasable = Boolean(price?.priceId);

  async function add() {
    if (!price?.priceId) return;
    try {
      await addItem.mutateAsync({
        itemYrn: productYrn(client.tenant, productId),
        quantity: qty,
        price: {
          priceId: price.priceId,
          originalAmount: price.amount,
          effectiveAmount: price.amount,
          currency: price.currency,
        },
      } as never);
      notify(`Added ${qty} × ${productName} to your bag`, "success");
    } catch (e) {
      notify(errorMessage(e), "error");
    }
  }

  if (!purchasable) {
    return (
      <p className="muted" style={{ marginTop: "var(--s-5)" }}>
        This product has no price in the current context and can’t be added to the bag.
      </p>
    );
  }

  return (
    <div className="cluster" style={{ gap: "var(--s-4)", marginTop: "var(--s-5)" }}>
      <div className="qty" role="group" aria-label="Quantity">
        <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease">–</button>
        <span aria-live="polite">{qty}</span>
        <button type="button" onClick={() => setQty((q) => q + 1)} aria-label="Increase">+</button>
      </div>
      <Button variant="accent" onClick={() => void add()} disabled={addItem.isPending}>
        {addItem.isPending ? "Adding…" : "Add to bag"}
      </Button>
      <Button variant="ghost" onClick={() => nav("/cart")}>
        View bag →
      </Button>
    </div>
  );
}
