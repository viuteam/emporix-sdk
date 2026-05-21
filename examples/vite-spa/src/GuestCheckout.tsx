import { useState } from "react";
import {
  useEmporix,
  useActiveCart,
  useCartMutations,
  useMatchPrices,
  useCheckout,
} from "@viu/emporix-sdk-react";

// Priced product on tenant `viu` (CHF/main/CH) — see plan-c-viu-context.md.
const PRODUCT_ID = "0f1e2d3c-4b5a";

/**
 * Hook-only guest flow: useActiveCart resolves storage→cart (or
 * bootstraps a new cart on "Start guest cart"). Cart survives reloads via
 * the EmporixStorage persistence of cartId and anonymous session.
 */
export function GuestCheckout(): React.JSX.Element {
  const { client, storage } = useEmporix();
  // `useActiveCart` reads storage on mount. Without `create: true` it's
  // read-only — a user who never clicks "Start guest cart" won't trigger
  // any cart creation. The button calls a `useActiveCart({ create: true })`
  // re-render trick via a state flag.
  const [wantCart, setWantCart] = useState<boolean>(() => storage.getCartId() !== null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cart = useActiveCart(wantCart ? { create: true } : undefined);
  const cartId = cart.data?.id ?? null;

  const prices = useMatchPrices(
    { items: [{ itemId: { itemType: "PRODUCT", id: PRODUCT_ID }, quantity: { quantity: 1 } }] },
    { enabled: cartId !== null },
  );
  const cartMutations = useCartMutations();
  const checkout = useCheckout();

  function startCart(): void {
    setError(null);
    setWantCart(true);
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
      // Cart is CLOSED on Emporix after a successful order — clear local state.
      storage.setCartId(null);
      setWantCart(false);
      setOrderId(r.orderId ?? null);
    } catch (e) {
      setError(String(e));
    }
  }

  function discardCart(): void {
    storage.setCartId(null);
    setWantCart(false);
    setOrderId(null);
  }

  const itemCount = cart.data?.items?.length ?? 0;

  return (
    <main>
      <h1>Guest checkout</h1>
      {!cartId && <button onClick={startCart}>Start guest cart</button>}
      {cartId && <p>Cart: {cartId} ({itemCount} item(s))</p>}
      {prices.data && <p>Unit price: {(prices.data[0] as { effectiveValue?: number } | undefined)?.effectiveValue ?? "—"}</p>}
      {cartId && !orderId && itemCount === 0 && (
        <button onClick={() => void addSampleItem()}>Add sample item</button>
      )}
      {cartId && !orderId && itemCount > 0 && (
        <button onClick={() => void placeOrder()}>Place guest order</button>
      )}
      {cartId && !orderId && <button onClick={discardCart}>Discard cart</button>}
      {orderId && <p>Order placed: {orderId}</p>}
      {error && <pre>{error}</pre>}
    </main>
  );
}
