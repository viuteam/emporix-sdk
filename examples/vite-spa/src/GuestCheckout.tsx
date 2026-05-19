import { useState } from "react";
import { useEmporix, useMatchPrices } from "@viu/emporix-sdk-react";

// Verified catalog product on tenant `viu` (see plan-c-viu-context.md).
const PRODUCT_ID = "69df9b7d78816f53657ba85b";
const ANON = { kind: "anonymous" } as const;

/** Full guest flow: anonymous cart → add item → match prices → place order. */
export function GuestCheckout(): React.JSX.Element {
  const { client } = useEmporix();
  const [cartId, setCartId] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prices = useMatchPrices(
    { items: [{ itemId: { itemType: "PRODUCT", id: PRODUCT_ID }, quantity: { quantity: 1 } }] },
    { enabled: cartId !== null },
  );

  async function startCart(): Promise<void> {
    setError(null);
    try {
      const cart = await client.carts.create({ currency: "EUR" }, ANON);
      const id = cart.id;
      if (!id) throw new Error("cart created without an id");
      await client.carts.addItem(
        id,
        {
          product: { id: PRODUCT_ID },
          quantity: 1,
          price: { priceId: PRODUCT_ID, originalAmount: 0, effectiveAmount: 0, currency: "EUR" },
        },
        ANON,
      );
      setCartId(id);
    } catch (e) {
      setError(String(e));
    }
  }

  async function placeOrder(): Promise<void> {
    if (!cartId) return;
    setError(null);
    try {
      // Freshness: re-match right before ordering (SDK is stateless on prices).
      await client.prices.matchByContext(
        { items: [{ itemId: { itemType: "PRODUCT", id: PRODUCT_ID }, quantity: { quantity: 1 } }] },
        ANON,
      );
      const r = await client.checkout.placeOrder(
        {
          cartId,
          customer: { email: "guest@example.com", guest: true },
          shipping: { methodId: "m", zoneId: "z", methodName: "Standard", amount: 0 },
          addresses: [
            {
              contactName: "Guest",
              street: "S",
              zipCode: "10115",
              city: "Berlin",
              country: "DE",
              type: "SHIPPING",
            },
            {
              contactName: "Guest",
              street: "S",
              zipCode: "10115",
              city: "Berlin",
              country: "DE",
              type: "BILLING",
            },
          ],
          paymentMethods: [{ provider: "none", method: "invoice" }],
        },
        ANON,
      );
      setOrderId(r.orderId ?? null);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <main>
      <h1>Guest checkout</h1>
      {!cartId && <button onClick={() => void startCart()}>Start guest cart</button>}
      {cartId && <p>Cart: {cartId}</p>}
      {prices.data && <p>Unit price: {prices.data[0]?.effectiveValue ?? "—"}</p>}
      {cartId && !orderId && <button onClick={() => void placeOrder()}>Place guest order</button>}
      {orderId && <p>Order placed: {orderId}</p>}
      {error && <pre>{error}</pre>}
    </main>
  );
}
