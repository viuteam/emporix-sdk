import { useState } from "react";
import { useParams } from "react-router-dom";
import { useOrder, useCancelOrder, useReorder } from "@viu/emporix-sdk-react";

function displayProductName(name: unknown, fallback: string): string {
  if (typeof name === "string") return name;
  if (name && typeof name === "object") {
    const values = Object.values(name as Record<string, unknown>);
    if (typeof values[0] === "string") return values[0];
  }
  return fallback;
}

export function OrderDetail(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { data: order, isLoading } = useOrder(id);
  const cancel = useCancelOrder();
  const reorder = useReorder();
  const [reorderResult, setReorderResult] = useState<{ added: number; errors: number } | null>(null);

  if (isLoading || !order) return <p>Loading…</p>;
  const canCancel = order.status === "CREATED";
  return (
    <section>
      <h2>Order {order.id}</h2>
      <p>Status: {order.status}</p>
      <p>Total: {order.totalPrice} {order.currency}</p>
      <h3>Items</h3>
      <ul>
        {order.entries.map((it) => {
          const product = it.product as { name?: unknown; id?: string } | undefined;
          return (
            <li key={it.id}>
              {displayProductName(product?.name, product?.id ?? "")} × {it.orderedAmount ?? it.amount} — {it.totalPrice} {order.currency}
            </li>
          );
        })}
      </ul>
      {canCancel && (
        <button
          disabled={cancel.isPending}
          onClick={() => { if (order.id) void cancel.mutateAsync(order.id); }}
        >
          {cancel.isPending ? "Cancelling…" : "Cancel order"}
        </button>
      )}
      <button
        disabled={reorder.isPending}
        onClick={async () => {
          if (!order.id) return;
          const r = await reorder.mutateAsync({ orderId: order.id });
          setReorderResult({ added: r.added, errors: r.errors.length });
        }}
      >
        {reorder.isPending ? "Reordering…" : "Reorder"}
      </button>
      {reorderResult && (
        <p>
          Added {reorderResult.added} item(s) to cart.
          {reorderResult.errors > 0 && ` ${reorderResult.errors} could not be re-added.`}
        </p>
      )}
    </section>
  );
}
