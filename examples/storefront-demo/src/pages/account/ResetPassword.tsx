import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { usePasswordReset } from "@viu/emporix-sdk-react";
import { Field } from "../../components/ui/Field";
import { Button } from "../../components/ui/Button";
import { useToast, errorMessage } from "../../app/Toasts";

/**
 * Two-phase password reset. Without a `?token=` query it shows the request
 * form (email → reset link). With a token it shows the confirm form
 * (token + new password). Emporix emails the token; paste it here in the demo.
 */
export function ResetPassword() {
  const [params] = useSearchParams();
  const { request, confirm } = usePasswordReset();
  const { notify } = useToast();

  const [email, setEmail] = useState("");
  const [token, setToken] = useState(params.get("token") ?? "");
  const [password, setPassword] = useState("");
  const [requested, setRequested] = useState(false);
  const hasToken = Boolean(params.get("token")) || requested;

  async function doRequest(e: FormEvent) {
    e.preventDefault();
    try {
      await request.mutateAsync({ email });
      setRequested(true);
      notify("If that email exists, a reset link is on its way", "success");
    } catch (err) {
      notify(errorMessage(err), "error");
    }
  }

  async function doConfirm(e: FormEvent) {
    e.preventDefault();
    try {
      await confirm.mutateAsync({ token, password });
      notify("Password reset — you can sign in now", "success");
    } catch (err) {
      notify(errorMessage(err), "error");
    }
  }

  return (
    <div className="container" style={{ paddingBlock: "var(--s-7)" }}>
      <div className="surface" style={{ maxWidth: "30rem", marginInline: "auto", padding: "var(--s-5)" }}>
        <h2 className="serif">Reset password</h2>

        <form onSubmit={doRequest} className="stack" style={{ gap: "var(--s-3)", marginTop: "var(--s-4)" }}>
          <Field
            label="Email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            hint="We'll send a reset token to this address."
          />
          <Button type="submit" variant="solid" disabled={request.isPending} style={{ alignSelf: "start" }}>
            {request.isPending ? "Sending…" : "Send reset link"}
          </Button>
        </form>

        {hasToken ? (
          <form onSubmit={doConfirm} className="stack" style={{ gap: "var(--s-3)", marginTop: "var(--s-5)", borderTop: "1px solid var(--line)", paddingTop: "var(--s-5)" }}>
            <p className="eyebrow">Have a token?</p>
            <Field label="Reset token" required value={token} onChange={(e) => setToken(e.target.value)} />
            <Field label="New password" type="password" required autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <Button type="submit" variant="accent" disabled={confirm.isPending} style={{ alignSelf: "start" }}>
              {confirm.isPending ? "Resetting…" : "Set new password"}
            </Button>
          </form>
        ) : null}

        <p className="muted" style={{ marginTop: "var(--s-4)", fontSize: "var(--step--1)" }}>
          Remembered it? <Link to="/account" className="u-underline">Sign in</Link>.
        </p>
      </div>
    </div>
  );
}
