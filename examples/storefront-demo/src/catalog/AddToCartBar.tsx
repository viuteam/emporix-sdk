import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useActiveCart, useCartCommands, useEmporix } from "@viu/emporix-sdk-react";
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
  const chain = useCartCommands(cartId);
  const { notify } = useToast();
  const nav = useNavigate();
  const [qty, setQty] = useState(1);

  // Emporix requires a priceId on internal-type cart items — so only priced
  // products are purchasable. Surface that instead of letting the API 400.
  const purchasable = Boolean(price?.priceId);

  async function add() {
    if (!price?.priceId) return;
    try {
      // One request: the add, then the calculated cart, which the hook puts straight
      // into the cart cache — no refetch after the add.
      await chain.mutateAsync({
        commands: [
          {
            type: "AddCartItem",
            data: {
              itemYrn: productYrn(client.tenant, productId),
              quantity: qty,
              price: {
                priceId: price.priceId,
                originalAmount: price.amount,
                effectiveAmount: price.amount,
                currency: price.currency,
              },
            },
          },
          { type: "GetCart" },
        ],
      });
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
      <Button variant="accent" onClick={() => void add()} disabled={chain.isPending}>
        {chain.isPending ? "Adding…" : "Add to bag"}
      </Button>
      <Button variant="ghost" onClick={() => nav("/cart")}>
        View bag →
      </Button>
    </div>
  );
}
