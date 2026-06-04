import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useActiveCart, useCartMutations } from "@viu/emporix-sdk-react";
import { cartLines, cartTotal, cartCoupons, type CartLineVM } from "../lib/adapters";
import { useProductNames } from "../lib/useProductNames";
import { money } from "../lib/format";
import { Button } from "../components/ui/Button";
import { Loading } from "../components/ui/Spinner";
import { EmptyState } from "../components/ui/EmptyState";
import { useToast, errorMessage } from "../app/Toasts";

export function Cart() {
  const { data: cart, isLoading } = useActiveCart({ create: true });
  const cartId = (cart as { id?: string } | null)?.id;
  const m = useCartMutations(cartId);
  const { notify } = useToast();
  const nav = useNavigate();
  const [coupon, setCoupon] = useState("");

  const lines = cartLines(cart);
  const total = cartTotal(cart);
  const coupons = cartCoupons(cart);
  const names = useProductNames(lines.map((l) => l.productId));

  async function setQty(line: CartLineVM, q: number) {
    if (q < 1) return;
    try {
      // `partial: true` → quantity-only update; no need to re-send itemYrn/price.
      await m.updateItem.mutateAsync({ itemId: line.id, patch: { quantity: q } as never, partial: true });
    } catch (e) {
      notify(errorMessage(e), "error");
    }
  }
  async function remove(line: CartLineVM) {
    try {
      await m.removeItem.mutateAsync({ itemId: line.id });
    } catch (e) {
      notify(errorMessage(e), "error");
    }
  }
  async function applyCoupon(e: FormEvent) {
    e.preventDefault();
    const code = coupon.trim();
    if (!code) return;
    try {
      await m.applyCoupon.mutateAsync({ code });
      setCoupon("");
      notify("Coupon applied", "success");
    } catch (err) {
      notify(errorMessage(err), "error");
    }
  }

  if (isLoading) {
    return (
      <div className="container">
        <Loading label="Loading your bag" />
      </div>
    );
  }
  if (lines.length === 0) {
    return (
      <div className="container">
        <EmptyState title="Your bag is empty">
          Nothing here yet — <Link to="/" className="u-underline">browse the catalogue</Link>.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <h2 className="serif" style={{ marginBottom: "var(--s-6)" }}>Your bag</h2>
      <div className="cart">
        <ul className="cart__lines">
          {lines.map((l) => (
            <li key={l.id} className="cart__line">
              <div className="cart__thumb">
                {l.image ? <img src={l.image} alt="" /> : <div className="pc__ph" />}
              </div>
              <div className="cart__line-main">
                <span className="serif" style={{ fontSize: "var(--step-1)" }}>
                  {names[l.productId] ?? l.name ?? l.productId}
                </span>
                <div className="cluster" style={{ gap: "var(--s-4)", marginTop: "var(--s-2)" }}>
                  <div className="qty" role="group" aria-label="Quantity">
                    <button type="button" onClick={() => void setQty(l, l.quantity - 1)} aria-label="Decrease">–</button>
                    <span>{l.quantity}</span>
                    <button type="button" onClick={() => void setQty(l, l.quantity + 1)} aria-label="Increase">+</button>
                  </div>
                  <button type="button" className="btn btn--ghost btn--sm" onClick={() => void remove(l)}>
                    Remove
                  </button>
                </div>
              </div>
              <div className="price" style={{ fontSize: "var(--step-1)" }}>
                {l.lineTotal ? money(l.lineTotal.amount, l.lineTotal.currency) : ""}
              </div>
            </li>
          ))}
        </ul>

        <aside className="cart__summary surface">
          <h3 className="serif">Summary</h3>
          <form onSubmit={applyCoupon} style={{ marginTop: "var(--s-4)" }}>
            <label className="field__label" htmlFor="coupon">Coupon</label>
            <div className="cluster" style={{ gap: "var(--s-2)", marginTop: "var(--s-2)" }}>
              <input
                id="coupon"
                className="input"
                value={coupon}
                onChange={(e) => setCoupon(e.target.value)}
                placeholder="Code"
                style={{ flex: 1 }}
              />
              <Button type="submit" variant="outline" size="sm" disabled={m.applyCoupon.isPending}>
                Apply
              </Button>
            </div>
          </form>
          {coupons.length > 0 ? (
            <div className="cluster" style={{ marginTop: "var(--s-3)" }}>
              {coupons.map((c) => (
                <button key={c} type="button" className="tag tag--accent" onClick={() => void m.removeCoupon.mutateAsync({ code: c })}>
                  {c} ✕
                </button>
              ))}
            </div>
          ) : null}

          <hr className="rule" style={{ marginBlock: "var(--s-5)" }} />
          <div className="cart__total">
            <span className="eyebrow">Total</span>
            <span className="price" style={{ fontSize: "var(--step-2)" }}>
              {total ? money(total.amount, total.currency) : "—"}
            </span>
          </div>
          <Button variant="accent" block onClick={() => nav("/checkout")} style={{ marginTop: "var(--s-4)" }}>
            Checkout →
          </Button>
        </aside>
      </div>
    </div>
  );
}
