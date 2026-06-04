import { useState } from "react";
import { Link } from "react-router-dom";
import type { Address } from "@viu/emporix-sdk";
import { AddressList } from "../../account/AddressList";
import { AddressForm } from "../../account/AddressForm";
import { RequireAuth } from "./RequireAuth";

export function Addresses() {
  // `editing` holds the address under edit; null means the "add new" form.
  const [editing, setEditing] = useState<Address | null>(null);
  // Remount the form on edit-target change so its defaults re-initialise.
  const formKey = (editing as { id?: string } | null)?.id ?? "new";

  return (
    <RequireAuth>
      <div className="container" style={{ paddingBlock: "var(--s-6)", maxWidth: "44rem" }}>
        <Link to="/account" className="u-underline muted" style={{ fontSize: "var(--step--1)" }}>← Account</Link>
        <h2 className="serif" style={{ marginBlock: "var(--s-3) var(--s-5)" }}>Addresses</h2>
        <div className="stack" style={{ gap: "var(--s-5)" }}>
          <AddressList
            onEdit={setEditing}
            onRemoved={(id) => {
              // If the address under edit was just deleted, drop the edit form.
              if ((editing as { id?: string } | null)?.id === id) setEditing(null);
            }}
          />
          <AddressForm key={formKey} editing={editing} onDone={() => setEditing(null)} />
        </div>
      </div>
    </RequireAuth>
  );
}
