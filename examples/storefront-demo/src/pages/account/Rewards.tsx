import { Link } from "react-router-dom";
import { RewardsPanel } from "../../account/RewardsPanel";
import { RequireAuth } from "./RequireAuth";

export function Rewards() {
  return (
    <RequireAuth>
      <div className="container" style={{ paddingBlock: "var(--s-6)", maxWidth: "44rem" }}>
        <Link to="/account" className="u-underline muted" style={{ fontSize: "var(--step--1)" }}>← Account</Link>
        <h2 className="serif" style={{ marginBlock: "var(--s-3) var(--s-5)" }}>Rewards</h2>
        <RewardsPanel />
      </div>
    </RequireAuth>
  );
}
