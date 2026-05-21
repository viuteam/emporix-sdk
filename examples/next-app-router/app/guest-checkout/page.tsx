"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useEmporix,
  useCart,
  useCartMutations,
  useCreateCart,
  useMatchPrices,
  useCheckout,
} from "@viu/emporix-sdk-react";

// Priced product on tenant `viu` (CHF/main/CH) — see plan-c-viu-context.md.
const PRODUCT_ID = "0f1e2d3c-4b5a";

type Phase = "empty" | "shopping" | "ordered";

/**
 * Hook-only guest flow: `useCart()` reads the active cartId from storage at
 * every render, paired with `useCreateCart` for explicit cart creation.
 * Mirrors `examples/vite-spa/src/GuestCheckout.tsx`.
 */
export default function GuestCheckoutPage(): React.JSX.Element {
  const { client, storage } = useEmporix();
  const qc = useQueryClient();
  const cart = useCart();
  const cartId = cart.data?.id ?? null;
  const createCart = useCreateCart();
  const cartMutations = useCartMutations();
  const checkout = useCheckout();
  const prices = useMatchPrices(
    { items: [{ itemId: { itemType: "PRODUCT", id: PRODUCT_ID }, quantity: { quantity: 1 } }] },
    { enabled: cartId !== null },
  );
  const [orderId, setOrderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function clearLocalCart(): Promise<void> {
    storage.setCartId(null);
    await qc.invalidateQueries({ queryKey: ["emporix", "cart"] });
  }

  async function startCart(): Promise<void> {
    setError(null);
    try {
      await createCart.mutateAsync({ currency: "CHF" });
    } catch (e) {
      setError(String(e));
    }
  }

  async function addSampleItem(): Promise<void> {
    if (!cartId) return;
    setError(null);
    try {
      const { data: matched } = await prices.refetch();
      const p = matched?.[0] as
        | { priceId?: string; originalValue?: number; effectiveValue?: number }
        | undefined;
      if (!p?.priceId) throw new Error("no price resolved for the product");
      await cartMutations.addItem.mutateAsync({
        itemYrn: `urn:yaas:hybris:product:product:${client.tenant};${PRODUCT_ID}`,
        quantity: 1,
        price: {
          priceId: p.priceId,
          originalAmount: p.originalValue ?? 0,
          effectiveAmount: p.effectiveValue ?? 0,
          currency: "CHF",
        },
      });
    } catch (e) {
      setError(String(e));
    }
  }

  async function placeOrder(): Promise<void> {
    if (!cartId) return;
    setError(null);
    try {
      const { data: fresh } = await prices.refetch();
      const amount = (fresh?.[0] as { effectiveValue?: number } | undefined)?.effectiveValue ?? 0;
      const r = await checkout.placeOrder.mutateAsync({
        input: {
          cartId,
          customer: { email: "guest@example.com", firstName: "Guest", lastName: "Shopper", guest: true },
          shipping: { methodId: "free", zoneId: "CH", methodName: "Free Shipping", amount: 0 },
          addresses: [
            { contactName: "Guest Shopper", street: "Rämistrasse 71", zipCode: "8006", city: "Zürich", country: "CH", type: "BILLING" },
            { contactName: "Guest Shopper", street: "Rämistrasse 71", zipCode: "8006", city: "Zürich", country: "CH", type: "SHIPPING" },
          ],
          paymentMethods: [{ provider: "custom", amount }],
        },
      });
      setOrderId(r.orderId ?? null);
      await clearLocalCart();
    } catch (e) {
      setError(String(e));
    }
  }

  async function discardCart(): Promise<void> {
    await clearLocalCart();
    setOrderId(null);
  }

  const itemCount = cart.data?.items?.length ?? 0;
  const phase: Phase = orderId ? "ordered" : cart.data ? "shopping" : "empty";

  return (
    <main>
      <h1>Guest checkout</h1>
      {phase === "empty" && (
        <button onClick={() => void startCart()} disabled={createCart.isPending}>
          {createCart.isPending ? "Starting…" : "Start guest cart"}
        </button>
      )}
      {phase === "shopping" && cartId && (
        <>
          <p>Cart: {cartId} ({itemCount} item(s))</p>
          {prices.data && (
            <p>
              Unit price:{" "}
              {(prices.data[0] as { effectiveValue?: number } | undefined)?.effectiveValue ?? "—"}
            </p>
          )}
          {itemCount === 0 ? (
            <button onClick={() => void addSampleItem()}>Add sample item</button>
          ) : (
            <button onClick={() => void placeOrder()}>Place guest order</button>
          )}
          <button onClick={() => void discardCart()}>Discard cart</button>
        </>
      )}
      {phase === "ordered" && <p>Order placed: {orderId}</p>}
      {error && <pre>{error}</pre>}
    </main>
  );
}
