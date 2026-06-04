import { Link } from "react-router-dom";
import { useMyReturns } from "@viu/emporix-sdk-react";
import { money, dateFmt } from "../../lib/format";
import { Loading } from "../../components/ui/Spinner";
import { EmptyState } from "../../components/ui/EmptyState";
import { RequireAuth } from "./RequireAuth";

type ReadReturn = {
  id?: string;
  approvalStatus?: string;
  received?: boolean;
  total?: { value?: number; currency?: string };
  metadata?: { createdAt?: string };
};

export function Returns() {
  return (
    <RequireAuth>
      <ReturnsInner />
    </RequireAuth>
  );
}

function ReturnsInner() {
  const { data, isLoading } = useMyReturns();
  const returns = (data ?? []) as ReadReturn[];

  return (
    <div className="container" style={{ paddingBlock: "var(--s-6)", maxWidth: "44rem" }}>
      <Link to="/account" className="u-underline muted" style={{ fontSize: "var(--step--1)" }}>← Account</Link>
      <h2 className="serif" style={{ marginBlock: "var(--s-3) var(--s-5)" }}>Returns</h2>

      {isLoading ? (
        <Loading label="Loading returns" />
      ) : returns.length === 0 ? (
        <EmptyState title="No returns">
          Start one from an order in your <Link to="/account/orders" className="u-underline">order history</Link>.
        </EmptyState>
      ) : (
        <ul className="stack" style={{ listStyle: "none", padding: 0, gap: "var(--s-3)" }}>
          {returns.map((r) => (
            <li key={r.id} className="surface" style={{ padding: "var(--s-4)", display: "flex", justifyContent: "space-between", gap: "var(--s-4)" }}>
              <div>
                <p className="serif">Return {r.id?.slice(0, 8) ?? "—"}</p>
                <p className="muted" style={{ fontSize: "var(--step--1)", marginTop: "var(--s-1)" }}>
                  {[dateFmt(r.metadata?.createdAt), r.received ? "received" : "awaiting items"].filter(Boolean).join(" · ")}
                </p>
              </div>
              <div style={{ textAlign: "right" }}>
                <span className="tag" style={{ fontSize: "var(--step--2)" }}>{r.approvalStatus ?? "PENDING"}</span>
                {r.total?.value !== undefined && r.total.currency ? (
                  <p className="price" style={{ marginTop: "var(--s-2)" }}>{money(r.total.value, r.total.currency)}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
