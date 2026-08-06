"use client";

import { useState } from "react";
import {
  useActiveCart,
  useCartMutations,
  useEmporix,
  useMatchPrices,
} from "@viu/emporix-sdk-react";
import { CURRENCY, DEMO_PRODUCT_ID } from "../site";

/**
 * The cart, through hooks only — and the two things `/guest-checkout` does not show.
 *
 * 1. **`useActiveCart({ create: true })`** resolves the stored cart or creates one, in a
 *    single hook. `/guest-checkout` deliberately does it the other way, with `useCart()`
 *    plus an explicit `useCreateCart`, so the two pages cover both shapes.
 * 2. **Line-level mutations** — quantity and removal. `/guest-checkout` only ever adds.
 *
 * This page used to add `product: { id: "demo" }` with `priceId: "demo"` and `currency:
 * "EUR"`. None of the three exists on any tenant, so the button could only ever fail; it
 * was a placeholder wearing the clothes of an example. A real add needs a real price,
 * because Emporix requires a `priceId` on an internal cart item — which is why
 * `useMatchPrices` runs first here, exactly as `/guest-checkout` does.
 *
 * Self-contained on purpose: no `@viu/emporix-examples-shared` import, so the file can be
 * copied out of this repo whole. That is why the cart shape is read inline below rather
 * than through the shared adapters, and why there is no styling — this example has no
 * stylesheet, and the point here is the hooks.
 */

/** The bits of an Emporix cart item this page renders. Read inline — see the note above. */
interface Line {
  id: string;
  quantity: number;
  name: string;
  amount: number | undefined;
  currency: string | undefined;
}

function lines(cart: unknown): Line[] {
  const items = (cart as { items?: unknown[] } | null | undefined)?.items ?? [];
  return items.map((raw) => {
    const it = raw as {
      id?: string;
      quantity?: number;
      itemYrn?: string;
      product?: { id?: string; name?: unknown };
      price?: { effectiveAmount?: number; currency?: string };
    };
    // Measured 2026-08-06: the cart item *does* carry `product.name`, as a plain string —
    // and in **English** («Just-in-Time Access (JIT)») even though this app binds `de`.
    // The cart appears to keep the name it was added with rather than re-localizing it, so
    // this is the one place in the example that ignores the bound language. Left as it
    // comes: fixing it means a product lookup per line, which `/[lang]/cart` in the
    // server-first example does and which would bury the hook story here.
    //
    // The fallbacks below still matter — `storefront-demo`'s adapter documents tenants
    // where `product` comes back empty.
    const name = typeof it.product?.name === "string" ? it.product.name : (it.product?.id ?? "");
    return {
      id: it.id ?? "",
      quantity: it.quantity ?? 1,
      name: name === "" ? (it.itemYrn ?? "item") : name,
      amount: it.price?.effectiveAmount,
      currency: it.price?.currency,
    };
  });
}

export default function CartPage(): React.JSX.Element {
  const { client } = useEmporix();
  const cart = useActiveCart({ create: true });
  const cartId = (cart.data as { id?: string } | null)?.id;
  // The id is passed rather than left to storage: the hook's own error message recommends
  // it, and it makes the dependency visible at the call site.
  const m = useCartMutations(cartId);
  const [error, setError] = useState<string | null>(null);

  const prices = useMatchPrices(
    {
      items: [
        { itemId: { itemType: "PRODUCT", id: DEMO_PRODUCT_ID }, quantity: { quantity: 1 } },
      ],
    },
    { enabled: cartId !== undefined },
  );

  async function add(): Promise<void> {
    setError(null);
    try {
      // Re-read rather than trusting what is in state: a price is the one thing that must
      // be current at the moment the item is added.
      const { data } = await prices.refetch();
      const p = data?.[0] as
        | { priceId?: string; originalValue?: number; effectiveValue?: number }
        | undefined;
      if (!p?.priceId) throw new Error("no price resolved — check the bound context in app/site.ts");
      await m.addItem.mutateAsync({
        // `itemYrn`, not `product: { id }`: the YRN form is what this tenant accepts for an
        // internal item.
        itemYrn: `urn:yaas:hybris:product:product:${client.tenant};${DEMO_PRODUCT_ID}`,
        quantity: 1,
        price: {
          priceId: p.priceId,
          originalAmount: p.originalValue ?? 0,
          effectiveAmount: p.effectiveValue ?? 0,
          currency: CURRENCY,
        },
      });
    } catch (e) {
      setError(String(e));
    }
  }

  async function setQuantity(itemId: string, quantity: number): Promise<void> {
    if (quantity < 1) return;
    setError(null);
    try {
      // `partial: true` → a quantity-only update, so the itemYrn and the price do not have
      // to be sent again.
      await m.updateItem.mutateAsync({ itemId, patch: { quantity } as never, partial: true });
    } catch (e) {
      setError(String(e));
    }
  }

  async function remove(itemId: string): Promise<void> {
    setError(null);
    try {
      await m.removeItem.mutateAsync({ itemId });
    } catch (e) {
      setError(String(e));
    }
  }

  if (cart.isLoading) return <main><h1>Cart</h1><p>Loading…</p></main>;

  const rows = lines(cart.data);
  const unit = (prices.data?.[0] as { effectiveValue?: number } | undefined)?.effectiveValue;

  return (
    <main>
      <h1>Cart</h1>
      <p>
        Cart {cartId ?? "—"} · {rows.length} {rows.length === 1 ? "line" : "lines"}
      </p>

      {rows.length === 0 ? (
        <p>Nothing in it yet.</p>
      ) : (
        <ul>
          {rows.map((l) => (
            <li key={l.id}>
              {l.name} — {l.quantity} ×{" "}
              {l.amount !== undefined ? `${l.amount} ${l.currency ?? ""}` : "?"}{" "}
              <button type="button" onClick={() => void setQuantity(l.id, l.quantity - 1)}>
                −
              </button>
              <button type="button" onClick={() => void setQuantity(l.id, l.quantity + 1)}>
                +
              </button>
              <button type="button" onClick={() => void remove(l.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <button type="button" onClick={() => void add()} disabled={cartId === undefined || m.addItem.isPending}>
        {m.addItem.isPending ? "Adding…" : "Add a priced product"}
      </button>
      {unit !== undefined ? <p>Resolved unit price: {unit} {CURRENCY}</p> : null}
      {error !== null ? <pre>{error}</pre> : null}
    </main>
  );
}
