import { Link } from "react-router-dom";
import type { OrderVM } from "../lib/adapters";
import { money, dateFmt } from "../lib/format";

/** A single row in the order-history list. */
export function OrderRow({ order }: { order: OrderVM }) {
  return (
    <Link
      to={`/account/orders/${encodeURIComponent(order.id)}`}
      className="surface"
      style={{ padding: "var(--s-4)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--s-4)" }}
    >
      <div>
        <p className="serif" style={{ fontSize: "var(--step-1)" }}>#{order.number}</p>
        <p className="muted" style={{ fontSize: "var(--step--1)", marginTop: "var(--s-1)" }}>
          {[dateFmt(order.createdAt), `${order.itemCount} item${order.itemCount === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
        </p>
      </div>
      <div style={{ textAlign: "right" }}>
        <span className="tag" style={{ fontSize: "var(--step--2)" }}>{order.status}</span>
        {order.total ? (
          <p className="price" style={{ marginTop: "var(--s-2)" }}>{money(order.total.amount, order.total.currency)}</p>
        ) : null}
      </div>
    </Link>
  );
}
