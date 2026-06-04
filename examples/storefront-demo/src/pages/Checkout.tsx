import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useActiveCart, useCheckout, useCustomerSession, useEmporix } from "@viu/emporix-sdk-react";
import { cartLines, cartTotal } from "../lib/adapters";
import { useProductNames } from "../lib/useProductNames";
import { money } from "../lib/format";
import { Button } from "../components/ui/Button";
import { Field } from "../components/ui/Field";
import { Loading } from "../components/ui/Spinner";
import { EmptyState } from "../components/ui/EmptyState";
import { useToast, errorMessage } from "../app/Toasts";

export function Checkout() {
  const { storage, client } = useEmporix();
  const qc = useQueryClient();
  const { data: cart, isLoading } = useActiveCart({ create: true });
  const { isAuthenticated, customer, saasToken } = useCustomerSession();
  const { placeOrder } = useCheckout();
  const { notify } = useToast();

  const cartId = (cart as { id?: string } | null)?.id;
  const lines = cartLines(cart);
  const total = cartTotal(cart);
  const names = useProductNames(lines.map((l) => l.productId));

  const [form, setForm] = useState({
    email: "",
    firstName: "Guest",
    lastName: "Shopper",
    street: "Rämistrasse 71",
    zipCode: "8006",
    city: "Zürich",
    country: "CH",
  });
  const [orderId, setOrderId] = useState<string | null>(null);

  const email = isAuthenticated ? (customer as { contactEmail?: string } | null)?.contactEmail ?? form.email : form.email;
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!cartId || !total) return;
    const address = {
      contactName: `${form.firstName} ${form.lastName}`,
      street: form.street,
      zipCode: form.zipCode,
      city: form.city,
      country: form.country,
    };
    const input = {
      cartId,
      customer: {
        email,
        firstName: form.firstName,
        lastName: form.lastName,
        guest: !isAuthenticated,
      },
      shipping: { methodId: "free", zoneId: form.country, methodName: "Free Shipping", amount: 0 },
      addresses: [
        { ...address, type: "BILLING" },
        { ...address, type: "SHIPPING" },
      ],
      paymentMethods: [{ provider: "custom", amount: total.amount }],
    };
    try {
      const r = await placeOrder.mutateAsync({
        input: input as never,
        // Customer checkout must carry the saasToken; guest doesn't need it.
        ...(isAuthenticated && saasToken ? { saasToken } : {}),
      });
      setOrderId((r as { orderId?: string }).orderId ?? null);
      // The cart is CLOSED on Emporix after a successful order — drop it locally
      // so a fresh cart bootstraps on the next visit.
      storage.setCartId(null);
      void qc.invalidateQueries({ queryKey: ["emporix", "cart"] });
      void qc.invalidateQueries({ queryKey: ["emporix", "active-cart"] });
    } catch (err) {
      notify(errorMessage(err), "error");
    }
  }

  if (orderId !== null) {
    return (
      <div className="container" style={{ paddingBlock: "var(--s-8)" }}>
        <div className="center-col" style={{ gap: "var(--s-3)" }}>
          <p className="eyebrow">Order placed</p>
          <h1 className="serif">Thank you.</h1>
          <p className="muted">
            Your order <strong className="serif">{orderId}</strong> is confirmed.
          </p>
          <div className="cluster" style={{ marginTop: "var(--s-4)" }}>
            <Link to={`/account/orders/${encodeURIComponent(orderId)}`} className="btn btn--solid">View order</Link>
            <Link to="/" className="btn btn--outline">Continue shopping</Link>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return <div className="container"><Loading label="Loading checkout" /></div>;
  }
  if (lines.length === 0) {
    return (
      <div className="container">
        <EmptyState title="Your bag is empty">
          Add something before checking out — <Link to="/" className="u-underline">browse</Link>.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <h2 className="serif" style={{ marginBottom: "var(--s-5)" }}>Checkout</h2>

      <div
        role="alert"
        style={{
          border: "1px solid var(--oxblood)",
          borderRadius: "var(--radius-lg)",
          padding: "var(--s-4)",
          marginBottom: "var(--s-6)",
          background: "color-mix(in oklab, var(--oxblood) 7%, var(--paper))",
        }}
      >
        <strong className="serif" style={{ color: "var(--oxblood)" }}>Live order.</strong>{" "}
        <span className="muted">Placing this order creates a real order in tenant <strong>{client.tenant}</strong>.</span>
      </div>

      <form onSubmit={submit} className="cart">
        <div className="stack">
          <p className="eyebrow">{isAuthenticated ? "Signed in" : "Guest"} contact</p>
          {!isAuthenticated ? (
            <Field label="Email" type="email" required value={form.email} onChange={set("email")} placeholder="you@example.com" />
          ) : (
            <p className="muted">{email}</p>
          )}
          <div className="cluster" style={{ gap: "var(--s-4)" }}>
            <Field label="First name" value={form.firstName} onChange={set("firstName")} />
            <Field label="Last name" value={form.lastName} onChange={set("lastName")} />
          </div>
          <Field label="Street" value={form.street} onChange={set("street")} />
          <div className="cluster" style={{ gap: "var(--s-4)" }}>
            <Field label="ZIP" value={form.zipCode} onChange={set("zipCode")} />
            <Field label="City" value={form.city} onChange={set("city")} />
            <Field label="Country" value={form.country} onChange={set("country")} />
          </div>
          <p className="muted" style={{ fontSize: "var(--step--1)" }}>Shipping: Free Shipping · Payment: demo "custom" provider.</p>
        </div>

        <aside className="cart__summary surface">
          <h3 className="serif">Summary</h3>
          <ul style={{ listStyle: "none", padding: 0, marginTop: "var(--s-3)" }}>
            {lines.map((l) => (
              <li key={l.id} className="cart__total" style={{ paddingBlock: "var(--s-1)", fontSize: "var(--step--1)" }}>
                <span className="muted">{(names[l.productId] ?? l.name ?? l.productId)} × {l.quantity}</span>
                <span className="price">{l.lineTotal ? money(l.lineTotal.amount, l.lineTotal.currency) : ""}</span>
              </li>
            ))}
          </ul>
          <hr className="rule" style={{ marginBlock: "var(--s-4)" }} />
          <div className="cart__total">
            <span className="eyebrow">Total</span>
            <span className="price" style={{ fontSize: "var(--step-2)" }}>{total ? money(total.amount, total.currency) : "—"}</span>
          </div>
          <Button type="submit" variant="accent" block disabled={placeOrder.isPending || !total} style={{ marginTop: "var(--s-4)" }}>
            {placeOrder.isPending ? "Placing order…" : "Place order"}
          </Button>
        </aside>
      </form>
    </div>
  );
}
