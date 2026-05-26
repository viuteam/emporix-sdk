import { Link } from "react-router-dom";
import { useMyOrdersInfinite } from "@viu/emporix-sdk-react";

export function OrderHistory(): React.JSX.Element {
  const { data, isLoading, isFetchingNextPage, fetchNextPage, hasNextPage } =
    useMyOrdersInfinite({ pageSize: 10 });
  if (isLoading) return <p>Loading…</p>;
  const orders = data?.pages.flatMap((p) => p.items) ?? [];
  if (orders.length === 0) return <p>No orders yet.</p>;
  return (
    <section>
      <h2>My Orders</h2>
      <ul>
        {orders.map((o) => (
          <li key={o.id}>
            <Link to={`/account/orders/${o.id}`}>
              {o.orderNumber} — {o.status} — {o.totalPrice.amount} {o.totalPrice.currency}
            </Link>
          </li>
        ))}
      </ul>
      {hasNextPage && (
        <button onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}>
          {isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      )}
    </section>
  );
}
