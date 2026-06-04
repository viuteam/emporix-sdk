import { Link } from "react-router-dom";
import { useCustomerSession } from "@viu/emporix-sdk-react";
import { AuthTabs } from "../account/AuthTabs";
import { Button } from "../components/ui/Button";
import { useToast, errorMessage } from "../app/Toasts";

type ReadCustomer = { firstName?: string; lastName?: string; contactEmail?: string; email?: string };

const TILES = [
  { to: "/account/profile", title: "Profile & password", desc: "Edit your details and change your password." },
  { to: "/account/addresses", title: "Addresses", desc: "Manage your saved delivery addresses." },
  { to: "/account/orders", title: "Orders", desc: "View order history, reorder, start a return." },
  { to: "/account/rewards", title: "Rewards", desc: "Check your points balance and redeem." },
  { to: "/account/lists", title: "Shopping lists", desc: "Curate and manage your saved lists." },
];

export function Account() {
  const { isAuthenticated, customer, logout } = useCustomerSession();
  const { notify } = useToast();

  if (!isAuthenticated) {
    return (
      <div className="container" style={{ paddingBlock: "var(--s-7)" }}>
        <p className="eyebrow" style={{ textAlign: "center" }}>Account</p>
        <h2 className="serif" style={{ textAlign: "center", marginBlock: "var(--s-2) var(--s-5)" }}>
          Welcome back
        </h2>
        <AuthTabs />
      </div>
    );
  }

  const c = (customer ?? {}) as ReadCustomer;
  const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.contactEmail || c.email || "there";

  async function signOut() {
    try {
      await logout();
      notify("Signed out", "success");
    } catch (err) {
      notify(errorMessage(err), "error");
    }
  }

  return (
    <div className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <div className="cluster" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <p className="eyebrow">Account</p>
          <h2 className="serif" style={{ marginTop: "var(--s-2)" }}>Hello, {name}</h2>
        </div>
        <Button variant="ghost" onClick={() => void signOut()}>Sign out</Button>
      </div>

      <div className="product-grid" style={{ marginTop: "var(--s-6)" }}>
        {TILES.map((t) => (
          <Link key={t.to} to={t.to} className="surface" style={{ padding: "var(--s-5)", display: "block" }}>
            <h3 className="serif" style={{ fontSize: "var(--step-1)" }}>{t.title}</h3>
            <p className="muted" style={{ marginTop: "var(--s-2)", fontSize: "var(--step--1)" }}>{t.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
