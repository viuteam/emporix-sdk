import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { useCustomerSession } from "@viu/emporix-sdk-react";
import { Field } from "../components/ui/Field";
import { Button } from "../components/ui/Button";
import { useToast, errorMessage } from "../app/Toasts";

type Tab = "login" | "signup";

/**
 * Sign-in / sign-up card. `signup` only creates the account on Emporix (no
 * auto-login), so after a successful signup we immediately `login` with the
 * same credentials. The parent `Account` page swaps to the dashboard once
 * `isAuthenticated` flips.
 */
export function AuthTabs() {
  const { login, signup } = useCustomerSession();
  const { notify } = useToast();
  const [tab, setTab] = useState<Tab>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (tab === "signup" && password !== confirm) {
      notify("Passwords do not match", "error");
      return;
    }
    setBusy(true);
    try {
      if (tab === "signup") {
        await signup({ email, password });
        notify("Account created", "success");
      }
      await login({ email, password });
      notify("Signed in", "success");
    } catch (err) {
      notify(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="surface" style={{ maxWidth: "30rem", marginInline: "auto", padding: "var(--s-5)" }}>
      <div className="cluster" role="tablist" aria-label="Account" style={{ gap: "var(--s-4)", marginBottom: "var(--s-4)" }}>
        {(["login", "signup"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className="btn btn--ghost btn--sm"
            style={{
              borderBottom: tab === t ? "2px solid var(--oxblood)" : "2px solid transparent",
              color: tab === t ? "var(--ink)" : "var(--muted)",
              borderRadius: 0,
            }}
          >
            {t === "login" ? "Sign in" : "Create account"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="stack" style={{ gap: "var(--s-3)" }}>
        <Field
          label="Email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          label="Password"
          type="password"
          required
          autoComplete={tab === "login" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {tab === "signup" ? (
          <Field
            label="Confirm password"
            type="password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        ) : null}
        <Button type="submit" variant="accent" block disabled={busy} style={{ marginTop: "var(--s-2)" }}>
          {busy ? "Please wait…" : tab === "login" ? "Sign in" : "Create account"}
        </Button>
      </form>

      {tab === "login" ? (
        <p className="muted" style={{ marginTop: "var(--s-4)", fontSize: "var(--step--1)" }}>
          Forgot your password? <Link to="/reset-password" className="u-underline">Reset it</Link>.
        </p>
      ) : null}
    </div>
  );
}
