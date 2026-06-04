import { useState } from "react";
import type { FormEvent } from "react";
import type { Address } from "@viu/emporix-sdk";
import { useAddressMutations } from "@viu/emporix-sdk-react";
import { Field } from "../components/ui/Field";
import { Button } from "../components/ui/Button";
import { useToast, errorMessage } from "../app/Toasts";

const EMPTY = {
  contactName: "",
  street: "",
  streetNumber: "",
  zipCode: "",
  city: "",
  country: "",
  contactPhone: "",
};

type ReadAddress = Partial<typeof EMPTY> & { id?: string };

/**
 * Add or edit an address via `useAddressMutations`. When `editing` is set the
 * form patches that address (`update`); otherwise it creates a new one (`add`).
 */
export function AddressForm({ editing, onDone }: { editing?: Address | null; onDone: () => void }) {
  const m = useAddressMutations();
  const { notify } = useToast();
  const e0 = (editing ?? {}) as ReadAddress;
  const [form, setForm] = useState({ ...EMPTY, ...pick(e0) });
  const set = (k: keyof typeof form) => (ev: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: ev.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      if (editing && (editing as ReadAddress).id) {
        await m.update.mutateAsync({ id: (editing as ReadAddress).id as string, patch: form });
        notify("Address updated", "success");
      } else {
        await m.add.mutateAsync(form);
        notify("Address added", "success");
        setForm({ ...EMPTY }); // clear so the next add starts blank
      }
      onDone();
    } catch (err) {
      notify(errorMessage(err), "error");
    }
  }

  const busy = m.add.isPending || m.update.isPending;
  return (
    <form onSubmit={submit} className="stack surface" style={{ gap: "var(--s-3)", padding: "var(--s-4)" }}>
      <h3 className="serif">{editing ? "Edit address" : "Add address"}</h3>
      <Field label="Contact name" value={form.contactName} onChange={set("contactName")} autoComplete="name" />
      <div className="cluster" style={{ gap: "var(--s-4)" }}>
        <Field label="Street" value={form.street} onChange={set("street")} autoComplete="address-line1" />
        <Field label="No." value={form.streetNumber} onChange={set("streetNumber")} />
      </div>
      <div className="cluster" style={{ gap: "var(--s-4)" }}>
        <Field label="ZIP" value={form.zipCode} onChange={set("zipCode")} autoComplete="postal-code" />
        <Field label="City" value={form.city} onChange={set("city")} autoComplete="address-level2" />
        <Field label="Country" value={form.country} onChange={set("country")} autoComplete="country" placeholder="DE" />
      </div>
      <Field label="Phone" value={form.contactPhone} onChange={set("contactPhone")} autoComplete="tel" />
      <div className="cluster" style={{ gap: "var(--s-3)" }}>
        <Button type="submit" variant="solid" disabled={busy}>
          {busy ? "Saving…" : editing ? "Update" : "Add"}
        </Button>
        {editing ? (
          <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        ) : null}
      </div>
    </form>
  );
}

function pick(a: ReadAddress): Partial<typeof EMPTY> {
  return {
    contactName: a.contactName ?? "",
    street: a.street ?? "",
    streetNumber: a.streetNumber ?? "",
    zipCode: a.zipCode ?? "",
    city: a.city ?? "",
    country: a.country ?? "",
    contactPhone: a.contactPhone ?? "",
  };
}
