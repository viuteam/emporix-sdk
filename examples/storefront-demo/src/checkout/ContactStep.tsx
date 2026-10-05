import { useState } from "react";
import type { FormEvent } from "react";
import { useCustomerSession } from "@viu/emporix-sdk-react";
import { Field } from "../components/ui/Field";
import { Button } from "../components/ui/Button";
import { Alert } from "../components/ui/Alert";
import { errorMessage } from "../app/Toasts";

export interface ContactDraft {
  email: string;
  firstName: string;
  lastName: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What is missing from a contact, by field; empty when complete. */
export function contactErrors(c: ContactDraft): Partial<Record<keyof ContactDraft, string>> {
  const e: Partial<Record<keyof ContactDraft, string>> = {};
  if (!EMAIL.test(c.email.trim())) e.email = "Enter a valid email address.";
  if (!c.firstName.trim()) e.firstName = "Required.";
  if (!c.lastName.trim()) e.lastName = "Required.";
  return e;
}

/**
 * Step 1. A guest types email and name, or signs in instead. A signed-in customer
 * sees the profile's values. Emporix requires the `saasToken` for a customer
 * order; the SDK persists it next to the customer token, but `setSaasToken` is
 * optional on a storage adapter, so a session can come back without it — then
 * only signing in again unlocks the order.
 */
export function ContactStep({
  value,
  onChange,
  onContinue,
}: {
  value: ContactDraft;
  onChange: (patch: Partial<ContactDraft>) => void;
  onContinue: () => void;
}) {
  const { isAuthenticated, saasToken, customer, login } = useCustomerSession();
  const [mode, setMode] = useState<"guest" | "login">("guest");
  const [touched, setTouched] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  // Annotated: without it the type is a union with `{}` and `errors.email` does not compile.
  const errors: Partial<Record<keyof ContactDraft, string>> = touched ? contactErrors(value) : {};
  const accountEmail = (customer as { contactEmail?: string } | null)?.contactEmail ?? value.email;
  const set = (k: keyof ContactDraft) => (e: { target: { value: string } }) => onChange({ [k]: e.target.value });

  async function signIn(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setLoginError(null);
    try {
      await login({ email: isAuthenticated ? accountEmail : loginEmail, password });
      setPassword("");
      setMode("guest");
    } catch (err) {
      setLoginError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function next(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(contactErrors(value)).length === 0) onContinue();
  }

  const needsToken = isAuthenticated && !saasToken;
  if (needsToken || mode === "login") {
    return (
      <form onSubmit={signIn} className="stack" noValidate>
        {needsToken ? (
          <>
            <Alert tone="warning">
              <strong>Sign in again to place the order.</strong> You are signed in, but this session lacks the token
              Emporix needs for a customer order.
            </Alert>
            <p>
              Signed in as <strong>{accountEmail}</strong>
            </p>
          </>
        ) : (
          <Field label="Email" type="email" autoComplete="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} />
        )}
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {loginError ? <Alert tone="danger">{loginError}</Alert> : null}
        <div className="co-actions">
          <Button type="submit" variant="accent" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
          {!needsToken ? (
            <Button type="button" variant="ghost" onClick={() => setMode("guest")}>
              Check out as a guest
            </Button>
          ) : null}
        </div>
      </form>
    );
  }

  // A signed-in customer whose profile is complete sees a card; one with a gap in
  // the profile gets the fields below, prefilled and with the email locked.
  if (isAuthenticated && Object.keys(contactErrors(value)).length === 0) {
    return (
      <form onSubmit={next} className="stack" noValidate>
        <div className="co-card">
          <strong>
            {value.firstName} {value.lastName}
          </strong>
          <span className="muted">{value.email}</span>
        </div>
        <div className="co-actions">
          <Button type="submit" variant="accent">
            Continue to shipping address
          </Button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={next} className="stack" noValidate>
      <Field
        label="Email"
        type="email"
        autoComplete="email"
        value={value.email}
        onChange={set("email")}
        error={errors.email}
        disabled={isAuthenticated}
      />
      <div className="form-grid form-grid--2">
        <Field label="First name" autoComplete="given-name" value={value.firstName} onChange={set("firstName")} error={errors.firstName} />
        <Field label="Last name" autoComplete="family-name" value={value.lastName} onChange={set("lastName")} error={errors.lastName} />
      </div>
      <div className="co-actions">
        <Button type="submit" variant="accent">
          Continue to shipping address
        </Button>
        {!isAuthenticated ? (
          <Button type="button" variant="ghost" onClick={() => setMode("login")}>
            Have an account? Sign in
          </Button>
        ) : null}
      </div>
    </form>
  );
}
