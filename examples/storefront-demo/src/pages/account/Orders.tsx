import { Link } from "react-router-dom";
import { useMyOrdersInfinite } from "@viu/emporix-sdk-react";
import { orderVM } from "../../lib/adapters";
import { OrderRow } from "../../account/OrderRow";
import { Button } from "../../components/ui/Button";
import { Loading } from "../../components/ui/Spinner";
import { EmptyState } from "../../components/ui/EmptyState";
import { RequireAuth } from "./RequireAuth";

export function Orders() {
  return (
    <RequireAuth>
      <OrdersInner />
    </RequireAuth>
  );
}

function OrdersInner() {
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useMyOrdersInfinite({ pageSize: 10 });
  const orders = (data?.pages ?? []).flatMap((p) => p.items ?? []).map(orderVM);

  return (
    <div className="container" style={{ paddingBlock: "var(--s-6)", maxWidth: "44rem" }}>
      <Link to="/account" className="u-underline muted" style={{ fontSize: "var(--step--1)" }}>← Account</Link>
      <h2 className="serif" style={{ marginBlock: "var(--s-3) var(--s-5)" }}>Orders</h2>

      {isLoading ? (
        <Loading label="Loading orders" />
      ) : orders.length === 0 ? (
        <EmptyState title="No orders yet">
          Confirmed orders show up here — <Link to="/" className="u-underline">start shopping</Link>.
          <br />
          <span className="muted" style={{ fontSize: "var(--step--1)" }}>
            Orders still awaiting payment aren't listed yet — this demo's
            "custom" payment is a stub, so its orders stay pending.
          </span>
        </EmptyState>
      ) : (
        <div className="stack" style={{ gap: "var(--s-3)" }}>
          {orders.map((o) => (
            <OrderRow key={o.id} order={o} />
          ))}
          {hasNextPage ? (
            <Button variant="outline" onClick={() => void fetchNextPage()} disabled={isFetchingNextPage} style={{ alignSelf: "center", marginTop: "var(--s-3)" }}>
              {isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
