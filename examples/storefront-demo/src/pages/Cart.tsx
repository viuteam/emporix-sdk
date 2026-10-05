import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { CartCommand } from "@viu/emporix-sdk";
import { useActiveCart, useActiveSite, useCartCommands } from "@viu/emporix-sdk-react";
import { cartLines, cartCoupons, type CartLineVM } from "../lib/adapters";
import { TotalsRows } from "../checkout/OrderSummary";
import { checkoutTotals } from "../checkout/totals";
import { useProductDetails } from "../lib/useProductNames";
import { money } from "@viu/emporix-examples-shared";
import { Button } from "../components/ui/Button";
import { Loading } from "../components/ui/Spinner";
import { EmptyState } from "../components/ui/EmptyState";
import { useToast, errorMessage } from "../app/Toasts";

export function Cart() {
  const { data: cart, isLoading } = useActiveCart({ create: true });
  const cartId = (cart as { id?: string } | null)?.id;
  const chain = useCartCommands(cartId);
  const { notify } = useToast();
  const nav = useNavigate();
  const [coupon, setCoupon] = useState("");

  const lines = cartLines(cart);
  const coupons = cartCoupons(cart);
  const site = useActiveSite();
  // Same function as the checkout, with the cart's delivery estimate, so cart and
  // checkout show the same numbers.
  const totals = checkoutTotals(cart, null, site?.includesTax !== false);
  const details = useProductDetails(lines.map((l) => l.productId));

  /**
   * Every change is one request: the write, then the calculated cart, which the hook
   * puts straight into the cart cache. Without the trailing `GetCart` each change would
   * cost a refetch on top.
   */
  const run = (command: CartCommand) => chain.mutateAsync({ commands: [command, { type: "GetCart" }] });

  async function setQty(line: CartLineVM, q: number) {
    if (q < 1) return;
    try {
      // `partial: true` → quantity-only update; no need to re-send itemYrn/price.
      await run({ type: "UpdateCartItem", data: { quantity: q }, options: { itemId: line.id, partial: true } });
    } catch (e) {
      notify(errorMessage(e), "error");
    }
  }
  async function remove(line: CartLineVM) {
    try {
      await run({ type: "DeleteCartItem", options: { itemId: line.id } });
    } catch (e) {
      notify(errorMessage(e), "error");
    }
  }
  async function removeCoupon(code: string) {
    try {
      await run({ type: "DeleteCartDiscounts", options: { codes: [code] } });
    } catch (e) {
      notify(errorMessage(e), "error");
    }
  }
  async function applyCoupon(e: FormEvent) {
    e.preventDefault();
    const code = coupon.trim();
    if (!code) return;
    try {
      await run({ type: "ApplyCartDiscount", data: { code } });
      setCoupon("");
      notify("Coupon applied", "success");
    } catch (err) {
      notify(errorMessage(err), "error");
    }
  }

  if (isLoading) {
    return (
      <div className="container">
        <Loading label="Loading your cart" />
      </div>
    );
  }
  if (lines.length === 0) {
    return (
      <div className="container">
        <EmptyState title="Your cart is empty">
          Nothing here yet — <Link to="/" className="u-underline">browse the catalogue</Link>.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="container page">
      <h1 className="page-title">Your cart</h1>
      <div className="cart">
        <ul className="cart__lines">
          {lines.map((l) => {
            const d = details[l.productId];
            const image = d?.image ?? l.image;
            return (
              <li key={l.id} className="cart__line">
                <div className="cart__thumb">{image ? <img src={image} alt="" /> : <span className="pc__ph" />}</div>
                <div>
                  {d?.code ? <span className="pc__code">Art. {d.code}</span> : null}
                  <p className="cart__name">{d?.name ?? (l.name || l.productId)}</p>
                  <div className="cluster cart__actions">
                    <div className="qty" role="group" aria-label="Quantity">
                      <button type="button" onClick={() => void setQty(l, l.quantity - 1)} aria-label="Decrease">
                        –
                      </button>
                      <span>{l.quantity}</span>
                      <button type="button" onClick={() => void setQty(l, l.quantity + 1)} aria-label="Increase">
                        +
                      </button>
                    </div>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => void remove(l)}>
                      Remove
                    </button>
                  </div>
                </div>
                <div className="price cart__line-total">
                  {l.lineTotal ? money(l.lineTotal.amount, l.lineTotal.currency) : ""}
                </div>
              </li>
            );
          })}
        </ul>

        <aside className="cart__summary surface">
          <h2>Summary</h2>
          <form onSubmit={applyCoupon} className="coupon-form">
            <label className="field__label" htmlFor="coupon">
              Coupon
            </label>
            <div className="cluster">
              <input
                id="coupon"
                className="input"
                value={coupon}
                onChange={(e) => setCoupon(e.target.value)}
                placeholder="Code"
              />
              <Button type="submit" variant="outline" size="sm" disabled={chain.isPending}>
                Apply
              </Button>
            </div>
          </form>
          {coupons.length > 0 ? (
            <div className="cluster cart__coupons">
              {coupons.map((c) => (
                <button key={c} type="button" className="tag tag--accent" onClick={() => void removeCoupon(c)}>
                  {c} ✕
                </button>
              ))}
            </div>
          ) : null}

          <hr className="rule" />
          {totals ? <TotalsRows totals={totals} /> : null}
          <p className="field__hint">Emporix estimates the delivery; you choose the method at checkout.</p>
          <Button variant="accent" block onClick={() => nav("/checkout")} className="cart__checkout">
            Checkout →
          </Button>
        </aside>
      </div>
    </div>
  );
}
