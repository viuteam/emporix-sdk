import {
  useMyRewardPoints,
  useRedeemOptions,
  useRedeemRewardPoints,
} from "@viu/emporix-sdk-react";
import { Button } from "../components/ui/Button";
import { Loading } from "../components/ui/Spinner";
import { EmptyState } from "../components/ui/EmptyState";
import { useToast, errorMessage } from "../app/Toasts";

type ReadOption = { id?: string; name?: string; description?: string; points?: number };

/** Reward-points balance and redeem options. */
export function RewardsPanel() {
  const { data: balance, isLoading: balLoading } = useMyRewardPoints();
  const { data: options, isLoading: optLoading } = useRedeemOptions();
  const redeem = useRedeemRewardPoints();
  const { notify } = useToast();
  const opts = (options ?? []) as ReadOption[];

  async function doRedeem(id: string) {
    try {
      const r = await redeem.mutateAsync({ redeemOptionId: id });
      const code = (r as { code?: string }).code;
      notify(code ? `Redeemed — coupon ${code}` : "Redeemed", "success");
    } catch (err) {
      notify(errorMessage(err), "error");
    }
  }

  return (
    <div className="stack" style={{ gap: "var(--s-5)" }}>
      <div className="surface center-col" style={{ padding: "var(--s-6)", gap: "var(--s-1)" }}>
        <p className="eyebrow">Your balance</p>
        <p className="serif" style={{ fontSize: "var(--step-4)" }}>
          {balLoading ? "…" : `${balance ?? 0}`}
        </p>
        <p className="muted" style={{ fontSize: "var(--step--1)" }}>points</p>
      </div>

      <div>
        <h3 className="serif" style={{ marginBottom: "var(--s-3)" }}>Redeem</h3>
        {optLoading ? (
          <Loading label="Loading options" />
        ) : opts.length === 0 ? (
          <EmptyState title="No redeem options">Nothing to redeem right now.</EmptyState>
        ) : (
          <ul className="stack" style={{ listStyle: "none", padding: 0, gap: "var(--s-3)" }}>
            {opts.map((o) => (
              <li key={o.id} className="surface" style={{ padding: "var(--s-4)", display: "flex", justifyContent: "space-between", gap: "var(--s-4)", alignItems: "center" }}>
                <div>
                  <p className="serif" style={{ fontSize: "var(--step-1)" }}>{o.name ?? "Reward"}</p>
                  {o.description ? <p className="muted" style={{ fontSize: "var(--step--1)", marginTop: "var(--s-1)" }}>{o.description}</p> : null}
                </div>
                <div className="cluster" style={{ gap: "var(--s-3)", alignItems: "center" }}>
                  <span className="price">{o.points ?? 0} pts</span>
                  <Button
                    variant="solid"
                    size="sm"
                    disabled={redeem.isPending || !o.id || (balance ?? 0) < (o.points ?? 0)}
                    onClick={() => o.id && void doRedeem(o.id)}
                  >
                    Redeem
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
