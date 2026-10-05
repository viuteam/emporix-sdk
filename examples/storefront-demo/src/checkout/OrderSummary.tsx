import { useState } from "react";
import { money } from "@viu/emporix-examples-shared";
import type { CartLineVM } from "../lib/adapters";
import type { ProductDetails } from "../lib/useProductNames";
import type { CheckoutTotals } from "./totals";

/**
 * Lines and totals next to the steps; on narrow screens a bar above them that
 * shows the total and opens the details.
 */
export function OrderSummary({
  lines,
  details,
  totals,
  deliveryName,
}: {
  lines: CartLineVM[];
  details: Record<string, ProductDetails>;
  totals: CheckoutTotals | undefined;
  deliveryName?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  return (
    <aside className="co-summary" aria-label="Order summary">
      <button type="button" className="co-summary__bar" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>{open ? "Hide" : "Show"} order summary</span>
        <span className="price">{totals ? money(totals.total, totals.currency) : "—"}</span>
      </button>
      <div className="co-summary__body" data-open={open}>
        <h2 className="co-summary__title">Order summary</h2>
        <ul className="co-lines">
          {lines.map((l) => {
            const d = details[l.productId];
            return (
              <li key={l.id} className="co-line">
                <span className="co-line__img">{d?.image ? <img src={d.image} alt="" /> : null}</span>
                <span>
                  <span className="co-line__name">{d?.name ?? (l.name || l.productId)}</span>
                  <span className="co-line__meta">
                    {d?.code ? `Art. ${d.code} · ` : ""}
                    {l.quantity} × {l.unit ? money(l.unit.amount, l.unit.currency) : "—"}
                  </span>
                </span>
                <span className="price co-line__total">
                  {l.lineTotal ? money(l.lineTotal.amount, l.lineTotal.currency) : ""}
                </span>
              </li>
            );
          })}
        </ul>
        {totals ? <TotalsRows totals={totals} deliveryName={deliveryName} /> : null}
      </div>
    </aside>
  );
}

/**
 * Subtotal, discount, delivery, VAT and total. On a tax-exclusive site the parts
 * are net and the VAT is its own line; otherwise they are gross and the VAT shows
 * as «incl.». A VAT of zero is not shown. Without a chosen method the delivery is
 * the cart's estimate. Shared by the summary and the cart page.
 */
export function TotalsRows({ totals, deliveryName }: { totals: CheckoutTotals; deliveryName?: string | undefined }) {
  const m = (n: number) => money(n, totals.currency);
  const net = !totals.includesTax;
  const excl = net ? " (excl. VAT)" : "";
  const delivery = net ? totals.deliveryNet : totals.deliveryGross;
  return (
    <div className="co-totals">
      <div className="co-totals__row">
        <span>Subtotal{excl}</span>
        <span>{m(net ? totals.itemsNet : totals.itemsGross)}</span>
      </div>
      {totals.discount > 0 ? (
        <div className="co-totals__row">
          <span>Discount</span>
          <span>−{m(totals.discount)}</span>
        </div>
      ) : null}
      <div className="co-totals__row">
        <span>
          {deliveryName ? `Delivery · ${deliveryName}` : "Estimated delivery"}
          {excl}
        </span>
        <span>{delivery === 0 ? "Free" : m(delivery)}</span>
      </div>
      {net && totals.tax ? (
        <div className="co-totals__row">
          <span>VAT</span>
          <span>{m(totals.tax)}</span>
        </div>
      ) : null}
      {totals.freeDeliveryGap !== undefined ? (
        <p className="co-totals__hint">Add {m(totals.freeDeliveryGap)} for free delivery</p>
      ) : null}
      <div className="co-totals__row co-totals__grand">
        <span>Total</span>
        <span>{m(totals.total)}</span>
      </div>
      {!net && totals.tax ? (
        <div className="co-totals__row muted">
          <span>incl. VAT</span>
          <span>{m(totals.tax)}</span>
        </div>
      ) : null}
    </div>
  );
}
