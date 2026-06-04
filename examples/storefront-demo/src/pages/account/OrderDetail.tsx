import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useOrder, useReorder, useCancelOrder } from "@viu/emporix-sdk-react";
import { orderVM, orderItems } from "../../lib/adapters";
import { money, dateFmt } from "../../lib/format";
import { ReturnForm } from "../../account/ReturnForm";
import { Button } from "../../components/ui/Button";
import { Loading } from "../../components/ui/Spinner";
import { EmptyState } from "../../components/ui/EmptyState";
import { useToast, errorMessage } from "../../app/Toasts";
import { RequireAuth } from "./RequireAuth";

// Statuses where a customer-initiated cancel is plausible (server has the final say).
const CANCELLABLE = new Set(["CREATED", "PENDING", "CONFIRMED"]);

export function OrderDetail() {
  return (
    <RequireAuth>
      <OrderDetailInner />
    </RequireAuth>
  );
}

function OrderDetailInner() {
  const { id } = useParams();
  const nav = useNavigate();
  const { notify } = useToast();
  const { data, isLoading } = useOrder(id);
  const reorder = useReorder();
  const cancel = useCancelOrder();
  const [returning, setReturning] = useState(false);

  if (isLoading) return <div className="container"><Loading label="Loading order" /></div>;
  if (!data || !id) {
    return (
      <div className="container">
        <EmptyState title="Order not found">
          <Link to="/account/orders" className="u-underline">Back to orders</Link>.
        </EmptyState>
      </div>
    );
  }

  const order = orderVM(data);
  const items = orderItems(data);

  async function doReorder() {
    try {
      const r = await reorder.mutateAsync({ orderId: id as string });
      notify(`Added ${r.added} item${r.added === 1 ? "" : "s"} to your bag`, "success");
      nav("/cart");
    } catch (err) {
      notify(errorMessage(err), "error");
    }
  }
  async function doCancel() {
    try {
      await cancel.mutateAsync({ orderId: id as string });
      notify("Order cancelled", "success");
    } catch (err) {
      notify(errorMessage(err), "error");
    }
  }

  return (
    <div className="container" style={{ paddingBlock: "var(--s-6)", maxWidth: "44rem" }}>
      <Link to="/account/orders" className="u-underline muted" style={{ fontSize: "var(--step--1)" }}>← Orders</Link>
      <div className="cluster" style={{ justifyContent: "space-between", alignItems: "baseline", marginBlock: "var(--s-3) var(--s-5)" }}>
        <h2 className="serif">Order #{order.number}</h2>
        <span className="tag">{order.status}</span>
      </div>
      {order.createdAt ? <p className="muted" style={{ fontSize: "var(--step--1)" }}>Placed {dateFmt(order.createdAt)}</p> : null}

      <ul className="stack" style={{ listStyle: "none", padding: 0, gap: "var(--s-3)", marginTop: "var(--s-5)" }}>
        {items.map((i) => (
          <li key={i.id} className="cluster" style={{ justifyContent: "space-between", gap: "var(--s-4)" }}>
            <span>{i.name} <span className="muted">× {i.quantity}</span></span>
            {i.lineTotal ? <span className="price">{money(i.lineTotal.amount, i.lineTotal.currency)}</span> : null}
          </li>
        ))}
      </ul>

      <hr className="rule" style={{ marginBlock: "var(--s-4)" }} />
      <div className="cart__total">
        <span className="eyebrow">Total</span>
        <span className="price" style={{ fontSize: "var(--step-1)" }}>
          {order.total ? money(order.total.amount, order.total.currency) : "—"}
        </span>
      </div>

      <div className="cluster" style={{ gap: "var(--s-3)", marginTop: "var(--s-6)" }}>
        <Button variant="solid" onClick={() => void doReorder()} disabled={reorder.isPending}>
          {reorder.isPending ? "Adding…" : "Reorder"}
        </Button>
        {items.length > 0 ? (
          <Button variant="outline" onClick={() => setReturning((v) => !v)}>
            {returning ? "Close return" : "Start a return"}
          </Button>
        ) : null}
        {CANCELLABLE.has(order.status) ? (
          <Button variant="ghost" onClick={() => void doCancel()} disabled={cancel.isPending}>
            {cancel.isPending ? "Cancelling…" : "Cancel order"}
          </Button>
        ) : null}
      </div>

      {returning ? (
        <div style={{ marginTop: "var(--s-5)" }}>
          <ReturnForm orderId={id} items={items} onDone={() => setReturning(false)} />
        </div>
      ) : null}
    </div>
  );
}
