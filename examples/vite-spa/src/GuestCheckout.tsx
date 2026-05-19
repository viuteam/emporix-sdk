import { useState } from "react";
import { useEmporix, useMatchPrices } from "@viu/emporix-sdk-react";

// Priced product on tenant `viu` (CHF/main/CH) — see plan-c-viu-context.md.
const PRODUCT_ID = "0f1e2d3c-4b5a";
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
      const cart = await client.carts.create({ currency: "CHF" }, ANON);
      const id = cart.cartId;
      if (!id) throw new Error("cart created without an id");
      // Resolve the real price first; the cart add-item needs a valid priceId.
      const matched = await client.prices.matchByContext(
        { items: [{ itemId: { itemType: "PRODUCT", id: PRODUCT_ID }, quantity: { quantity: 1 } }] },
        ANON,
      );
      const p = matched[0] as
        | { priceId?: string; originalValue?: number; effectiveValue?: number }
        | undefined;
      if (!p?.priceId) throw new Error("no price resolved for the product");
      // Emporix resolves the cart product via `itemYrn` (or `product`); the
      // priced item here is not a plain catalog product, so use the YRN.
      await client.carts.addItem(
        id,
        {
          itemYrn: `urn:yaas:hybris:product:product:${client.tenant};${PRODUCT_ID}`,
          quantity: 1,
          price: {
            priceId: p.priceId,
            originalAmount: p.originalValue ?? 0,
            effectiveAmount: p.effectiveValue ?? 0,
            currency: "CHF",
          },
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
          customer: {
            email: "guest@example.com",
            firstName: "Guest",
            lastName: "Shopper",
            guest: true,
          },
          // methodId/zoneId must be REAL ids from your tenant's Shipping
          // service — placeholders are rejected at checkout.
          shipping: { methodId: "m", zoneId: "z", methodName: "Standard", amount: 0 },
          addresses: [
            {
              contactName: "Guest",
              street: "S",
              zipCode: "8000",
              city: "Zürich",
              country: "CH",
              type: "SHIPPING",
            },
            {
              contactName: "Guest",
              street: "S",
              zipCode: "8000",
              city: "Zürich",
              country: "CH",
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
