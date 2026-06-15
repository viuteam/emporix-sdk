import { useState } from "react";
import type { Address } from "@viu/emporix-sdk";
import { SelectField } from "../components/ui/Field";
import { AddressFields, type AddressDraft } from "./AddressFields";

/** Maps a saved customer `Address` onto an editable `AddressDraft`. */
function addressToDraft(a: Address): AddressDraft {
  return {
    contactName: a.contactName ?? "",
    companyName: a.companyName ?? "",
    street: a.street ?? "",
    streetNumber: a.streetNumber ?? "",
    zipCode: a.zipCode ?? "",
    city: a.city ?? "",
    country: a.country ?? "",
    contactPhone: a.contactPhone ?? "",
  };
}

/**
 * One titled address block. For logged-in customers with saved addresses it
 * shows a picker that copies the chosen address into the draft; everyone can
 * also edit the fields directly. `savedAddresses` is `undefined` for guests
 * (the `useCustomerAddresses` query is idle without a token).
 */
export function AddressSection({
  title,
  value,
  onChange,
  savedAddresses,
  idPrefix,
}: {
  title: string;
  value: AddressDraft;
  onChange: (patch: Partial<AddressDraft>) => void;
  savedAddresses?: Address[];
  idPrefix: string;
}) {
  // "" = manual entry; otherwise the chosen saved-address id.
  const [picked, setPicked] = useState("");
  const saved = savedAddresses ?? [];
  return (
    <div className="stack" style={{ gap: "var(--s-3)" }}>
      <p className="eyebrow">{title}</p>
      {saved.length > 0 ? (
        <SelectField
          id={`${idPrefix}-saved`}
          label="Use a saved address"
          value={picked}
          onChange={(e) => {
            const id = e.target.value;
            setPicked(id);
            const hit = saved.find((a) => a.id === id);
            if (hit) onChange(addressToDraft(hit));
          }}
        >
          <option value="">Enter a new address…</option>
          {saved.map((a) => (
            <option key={a.id} value={a.id}>
              {[a.contactName, a.street, a.city].filter(Boolean).join(", ")}
            </option>
          ))}
        </SelectField>
      ) : null}
      <AddressFields value={value} onChange={onChange} idPrefix={idPrefix} />
    </div>
  );
}
