import { useState } from "react";
import type { FormEvent } from "react";
import type { Customer } from "@viu/emporix-sdk";
import { useCustomerSession, useUpdateCustomer } from "@viu/emporix-sdk-react";
import { Field } from "../components/ui/Field";
import { Button } from "../components/ui/Button";
import { Loading } from "../components/ui/Spinner";
import { useToast, errorMessage } from "../app/Toasts";

// The profile read shape we touch (Customer is a large generated union).
type ReadCustomer = {
  id?: string;
  firstName?: string;
  lastName?: string;
  contactEmail?: string;
  contactPhone?: string;
};

/**
 * Edits the logged-in customer's core profile via `useUpdateCustomer`.
 *
 * The `me` query may still be loading on first paint, so we wait for it and
 * seed the fields from a *present* customer — initialising form state from a
 * null customer would leave the inputs stuck empty (useState ignores later
 * prop changes). The inner form is keyed by customer id so a re-login reseeds.
 */
export function ProfileForm() {
  const { customer } = useCustomerSession();
  if (!customer) return <Loading label="Loading profile" />;
  return <ProfileFields key={(customer as ReadCustomer).id ?? "me"} customer={customer} />;
}

function ProfileFields({ customer }: { customer: Customer }) {
  const update = useUpdateCustomer();
  const { notify } = useToast();
  const c = customer as ReadCustomer;

  const [form, setForm] = useState({
    firstName: c.firstName ?? "",
    lastName: c.lastName ?? "",
    contactEmail: c.contactEmail ?? "",
    contactPhone: c.contactPhone ?? "",
  });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await update.mutateAsync({
        firstName: form.firstName,
        lastName: form.lastName,
        contactEmail: form.contactEmail,
        contactPhone: form.contactPhone,
      });
      notify("Profile saved", "success");
    } catch (err) {
      notify(errorMessage(err), "error");
    }
  }

  return (
    <form onSubmit={submit} className="stack" style={{ gap: "var(--s-3)" }}>
      <h3 className="serif">Profile</h3>
      <div className="cluster" style={{ gap: "var(--s-4)" }}>
        <Field label="First name" value={form.firstName} onChange={set("firstName")} autoComplete="given-name" />
        <Field label="Last name" value={form.lastName} onChange={set("lastName")} autoComplete="family-name" />
      </div>
      <Field label="Contact email" type="email" value={form.contactEmail} onChange={set("contactEmail")} autoComplete="email" />
      <Field label="Phone" value={form.contactPhone} onChange={set("contactPhone")} autoComplete="tel" />
      <Button type="submit" variant="solid" disabled={update.isPending} style={{ alignSelf: "start" }}>
        {update.isPending ? "Saving…" : "Save profile"}
      </Button>
    </form>
  );
}
