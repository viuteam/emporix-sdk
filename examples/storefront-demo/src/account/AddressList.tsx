import type { Address } from "@viu/emporix-sdk";
import { useCustomerAddresses, useAddressMutations } from "@viu/emporix-sdk-react";
import { Button } from "../components/ui/Button";
import { Loading } from "../components/ui/Spinner";
import { EmptyState } from "../components/ui/EmptyState";
import { useToast, errorMessage } from "../app/Toasts";

type ReadAddress = {
  id?: string;
  contactName?: string;
  street?: string;
  streetNumber?: string;
  zipCode?: string;
  city?: string;
  country?: string;
};

/** Lists the customer's saved addresses with edit/delete actions. */
export function AddressList({
  onEdit,
  onRemoved,
}: {
  onEdit: (a: Address) => void;
  /** Called after a successful delete so the parent can clear a stale edit form. */
  onRemoved?: (id: string) => void;
}) {
  const { data, isLoading } = useCustomerAddresses();
  const m = useAddressMutations();
  const { notify } = useToast();
  const addresses = (data ?? []) as ReadAddress[];

  if (isLoading) return <Loading label="Loading addresses" />;
  if (addresses.length === 0) {
    return <EmptyState title="No addresses yet">Add one below.</EmptyState>;
  }

  async function remove(id: string) {
    try {
      await m.remove.mutateAsync({ id });
      notify("Address removed", "success");
      onRemoved?.(id);
    } catch (err) {
      notify(errorMessage(err), "error");
    }
  }

  return (
    <ul className="stack" style={{ listStyle: "none", padding: 0, gap: "var(--s-3)" }}>
      {addresses.map((a) => (
        <li key={a.id} className="surface" style={{ padding: "var(--s-4)", display: "flex", justifyContent: "space-between", gap: "var(--s-4)" }}>
          <div>
            <p className="serif" style={{ fontSize: "var(--step-1)" }}>{a.contactName || "—"}</p>
            <p className="muted" style={{ fontSize: "var(--step--1)", marginTop: "var(--s-1)" }}>
              {[a.street, a.streetNumber].filter(Boolean).join(" ")}
              {a.street ? <br /> : null}
              {[a.zipCode, a.city].filter(Boolean).join(" ")}{a.country ? ` · ${a.country}` : ""}
            </p>
          </div>
          <div className="cluster" style={{ gap: "var(--s-2)", alignItems: "start" }}>
            <Button variant="ghost" size="sm" onClick={() => onEdit(a as Address)}>Edit</Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={m.remove.isPending}
              onClick={() => a.id && void remove(a.id)}
            >
              Delete
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
