import { useState } from "react";
import type { FormEvent } from "react";
import { useCreateReturn } from "@viu/emporix-sdk-react";
import type { OrderItemVM } from "../lib/adapters";
import { Field } from "../components/ui/Field";
import { Button } from "../components/ui/Button";
import { useToast, errorMessage } from "../app/Toasts";

/**
 * "Start a return" form. Lets the customer pick quantities per order line and
 * a reason, then submits a Return whose body references the order and the
 * returned items (`{ orders: [{ id, items }], reason }`).
 */
export function ReturnForm({
  orderId,
  items,
  onDone,
}: {
  orderId: string;
  items: OrderItemVM[];
  onDone: () => void;
}) {
  const create = useCreateReturn();
  const { notify } = useToast();
  // qty[itemId] = how many of that line to return (0 = exclude).
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");

  const setItemQty = (id: string, max: number, raw: number) =>
    setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(max, raw)) }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const returnItems = items
      .filter((i) => (qty[i.id] ?? 0) > 0)
      .map((i) => ({ id: i.id, quantity: qty[i.id] as number }));
    if (returnItems.length === 0) {
      notify("Pick at least one item to return", "error");
      return;
    }
    try {
      await create.mutateAsync({
        orders: [{ id: orderId, items: returnItems }],
        reason: { details: reason },
      } as never);
      notify("Return requested", "success");
      onDone();
    } catch (err) {
      notify(errorMessage(err), "error");
    }
  }

  return (
    <form onSubmit={submit} className="stack surface" style={{ gap: "var(--s-3)", padding: "var(--s-4)" }}>
      <h3 className="serif">Start a return</h3>
      <ul className="stack" style={{ listStyle: "none", padding: 0, gap: "var(--s-2)" }}>
        {items.map((i) => (
          <li key={i.id} className="cluster" style={{ justifyContent: "space-between", gap: "var(--s-4)" }}>
            <span className="muted" style={{ fontSize: "var(--step--1)" }}>{i.name} <span className="muted">(ordered {i.quantity})</span></span>
            <input
              type="number"
              className="input"
              min={0}
              max={i.quantity}
              value={qty[i.id] ?? 0}
              onChange={(e) => setItemQty(i.id, i.quantity, Number(e.target.value))}
              style={{ width: "4.5rem" }}
              aria-label={`Return quantity for ${i.name}`}
            />
          </li>
        ))}
      </ul>
      <Field label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why are you returning these?" />
      <div className="cluster" style={{ gap: "var(--s-3)" }}>
        <Button type="submit" variant="accent" disabled={create.isPending}>
          {create.isPending ? "Submitting…" : "Request return"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}
