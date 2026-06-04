import { useState } from "react";
import type { FormEvent } from "react";
import { useChangePassword } from "@viu/emporix-sdk-react";
import { Field } from "../components/ui/Field";
import { Button } from "../components/ui/Button";
import { useToast, errorMessage } from "../app/Toasts";

/** Changes the logged-in customer's password via `useChangePassword`. */
export function PasswordForm() {
  const change = useChangePassword();
  const { notify } = useToast();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (form.newPassword !== form.confirm) {
      notify("New passwords do not match", "error");
      return;
    }
    try {
      await change.mutateAsync({ currentPassword: form.currentPassword, newPassword: form.newPassword });
      notify("Password changed", "success");
      setForm({ currentPassword: "", newPassword: "", confirm: "" });
    } catch (err) {
      notify(errorMessage(err), "error");
    }
  }

  return (
    <form onSubmit={submit} className="stack" style={{ gap: "var(--s-3)" }}>
      <h3 className="serif">Password</h3>
      <Field label="Current password" type="password" required autoComplete="current-password" value={form.currentPassword} onChange={set("currentPassword")} />
      <div className="cluster" style={{ gap: "var(--s-4)" }}>
        <Field label="New password" type="password" required autoComplete="new-password" value={form.newPassword} onChange={set("newPassword")} />
        <Field label="Confirm new" type="password" required autoComplete="new-password" value={form.confirm} onChange={set("confirm")} />
      </div>
      <Button type="submit" variant="outline" disabled={change.isPending} style={{ alignSelf: "start" }}>
        {change.isPending ? "Updating…" : "Change password"}
      </Button>
    </form>
  );
}
