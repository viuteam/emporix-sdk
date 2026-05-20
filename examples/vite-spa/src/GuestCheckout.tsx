import { useState } from "react";
import {
  useEmporix,
  useCart,
  useCreateCart,
  useCartMutations,
  useMatchPrices,
  useCheckout,
} from "@viu/emporix-sdk-react";

// Priced product on tenant `viu` (CHF/main/CH) — see plan-c-viu-context.md.
const PRODUCT_ID = "0f1e2d3c-4b5a";

/**
 * Hook-only guest flow: persisted cart recovery + cart create + add item +
 * price match + place order. The cart survives a browser reload thanks to the
 * `EmporixStorage` persistence of cartId and the anonymous session.
 */
export function GuestCheckout(): React.JSX.Element {
  const { client, storage } = useEmporix();
  // Persisted cart-id is the source of truth on mount.
  const [cartId, setCartId] = useState<string | null>(() => storage.getCartId());
  const [orderId, setOrderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // On reload with a persisted cartId, this fires immediately and recovers the cart.
  const cart = useCart(cartId ?? undefined);

  const createCart = useCreateCart();
  const prices = useMatchPrices(
    { items: [{ itemId: { itemType: "PRODUCT", id: PRODUCT_ID }, quantity: { quantity: 1 } }] },
    { enabled: cartId !== null },
  );
  const cartMutations = useCartMutations(cartId ?? "");
  const checkout = useCheckout();

  async function startCart(): Promise<void> {
    setError(null);
    try {
      const created = await createCart.mutateAsync({ currency: "CHF" });
      const id = created.cartId;
      if (!id) throw new Error("cart created without an id");
      // useCreateCart already persisted cartId via storage.setCartId(id);
      // mirror it into local state so dependent hooks (prices, useCartMutations,
      // useCart) re-bind to the real id on the next render.
      setCartId(id);
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
      // Cart is CLOSED on Emporix after a successful order — clear local state.
      storage.setCartId(null);
      setCartId(null);
      setOrderId(r.orderId ?? null);
    } catch (e) {
      setError(String(e));
    }
  }

  function discardCart(): void {
    storage.setCartId(null);
    setCartId(null);
    setOrderId(null);
  }

  const itemCount = cart.data?.items?.length ?? 0;

  return (
    <main>
      <h1>Guest checkout</h1>
      {!cartId && <button onClick={() => void startCart()}>Start guest cart</button>}
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
