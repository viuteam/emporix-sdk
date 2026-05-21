"use client";

import { useState } from "react";
import { useCheckout } from "@viu/emporix-sdk-react";
import type { CheckoutInput } from "@viu/emporix-sdk";

function demoOrder(cartId: string): CheckoutInput {
  return {
    cartId,
    customer: { email: "demo@example.com", id: "demo" },
    shipping: { methodId: "m", zoneId: "z", methodName: "DHL", amount: 0 },
    addresses: [
      { contactName: "Demo", street: "S", zipCode: "1", city: "B", country: "DE", type: "SHIPPING" },
      { contactName: "Demo", street: "S", zipCode: "1", city: "B", country: "DE", type: "BILLING" },
    ],
    paymentMethods: [{ provider: "none", method: "invoice" }],
  };
}

export default function CheckoutPage(): React.JSX.Element {
  const { placeOrder } = useCheckout();
  const [cartId, setCartId] = useState("");
  const [saasToken, setSaasToken] = useState("");
  const [orderId, setOrderId] = useState<string | null>(null);

  async function submit(): Promise<void> {
    const r = await placeOrder.mutateAsync({
      input: demoOrder(cartId),
      ...(saasToken ? { saasToken } : {}),
    });
    setOrderId(r.orderId ?? null);
  }

  return (
    <main>
      <h1>Checkout</h1>
      <input
        placeholder="cart id"
        value={cartId}
        onChange={(e) => setCartId(e.target.value)}
      />
      <input
        placeholder="saas token (optional)"
        value={saasToken}
        onChange={(e) => setSaasToken(e.target.value)}
      />
      <button disabled={!cartId || placeOrder.isPending} onClick={() => void submit()}>
        Place order
      </button>
      {orderId && <p>Order: {orderId}</p>}
      {placeOrder.isError && <p>Checkout failed.</p>}
    </main>
  );
}
