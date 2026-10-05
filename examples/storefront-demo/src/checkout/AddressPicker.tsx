import { useState } from "react";
import type { Address } from "@viu/emporix-sdk";
import { RadioCard } from "../components/ui/RadioCard";
import {
  AddressFields,
  EMPTY_ADDRESS,
  addressToDraft,
  formatAddress,
  type AddressDraft,
  type AddressErrors,
} from "./AddressFields";

function matches(a: Address, d: AddressDraft): boolean {
  return (
    (a.contactName ?? "") === d.contactName &&
    (a.street ?? "") === d.street &&
    (a.zipCode ?? "") === d.zipCode &&
    (a.city ?? "") === d.city
  );
}

/**
 * Saved addresses as radio cards plus «New address», or the bare form when
 * there is nothing saved (always the case for a guest).
 */
export function AddressPicker({
  value,
  onChange,
  saved,
  countries,
  idPrefix,
  errors,
}: {
  value: AddressDraft;
  onChange: (patch: Partial<AddressDraft>) => void;
  saved: Address[];
  countries: string[];
  idPrefix: string;
  errors: AddressErrors;
}) {
  // "new" = the form; otherwise the id of the saved address in use.
  const [picked, setPicked] = useState<string>(() => saved.find((a) => matches(a, value))?.id ?? "new");
  const showForm = saved.length === 0 || picked === "new";
  return (
    <div className="stack">
      {saved.length > 0 ? (
        <div className="radio-list">
          {saved.map((a) =>
            a.id ? (
              <RadioCard
                key={a.id}
                name={`${idPrefix}-address`}
                value={a.id}
                checked={picked === a.id}
                onChange={(id) => {
                  setPicked(id);
                  onChange(addressToDraft(a));
                }}
                title={a.contactName ?? "Saved address"}
                description={formatAddress(addressToDraft(a))}
                aside={a.isDefault ? "Default" : undefined}
              />
            ) : null,
          )}
          <RadioCard
            name={`${idPrefix}-address`}
            value="new"
            checked={picked === "new"}
            onChange={() => {
              setPicked("new");
              onChange({ ...EMPTY_ADDRESS, contactName: value.contactName, country: countries[0] ?? "" });
            }}
            title="New address"
          />
        </div>
      ) : null}
      {showForm ? <AddressFields value={value} onChange={onChange} idPrefix={idPrefix} countries={countries} errors={errors} /> : null}
    </div>
  );
}
