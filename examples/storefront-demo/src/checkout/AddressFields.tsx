import { Field } from "../components/ui/Field";

export type AddressDraft = {
  contactName: string;
  companyName?: string;
  street: string;
  streetNumber?: string;
  zipCode: string;
  city: string;
  country: string;
  contactPhone?: string;
};

/** A blank address draft. Spread into `useState` so optional fields are "". */
export const EMPTY_ADDRESS: AddressDraft = {
  contactName: "",
  companyName: "",
  street: "",
  streetNumber: "",
  zipCode: "",
  city: "",
  country: "",
  contactPhone: "",
};

/**
 * Pure, controlled address field set. Holds no state and never persists — the
 * parent owns the `AddressDraft` and receives single-field patches via
 * `onChange`. `idPrefix` keeps input ids unique when two sections (shipping +
 * billing) render on the same page. Reused for both checkout addresses.
 */
export function AddressFields({
  value,
  onChange,
  idPrefix,
}: {
  value: AddressDraft;
  onChange: (patch: Partial<AddressDraft>) => void;
  idPrefix: string;
}) {
  const set =
    (k: keyof AddressDraft) =>
    (e: { target: { value: string } }) =>
      onChange({ [k]: e.target.value });
  return (
    <div className="stack" style={{ gap: "var(--s-3)" }}>
      <Field
        id={`${idPrefix}-contactName`}
        label="Contact name"
        value={value.contactName}
        onChange={set("contactName")}
        autoComplete="name"
      />
      <Field
        id={`${idPrefix}-companyName`}
        label="Company (optional)"
        value={value.companyName ?? ""}
        onChange={set("companyName")}
        autoComplete="organization"
      />
      <div className="cluster" style={{ gap: "var(--s-4)" }}>
        <Field
          id={`${idPrefix}-street`}
          label="Street"
          value={value.street}
          onChange={set("street")}
          autoComplete="address-line1"
        />
        <Field
          id={`${idPrefix}-streetNumber`}
          label="No."
          value={value.streetNumber ?? ""}
          onChange={set("streetNumber")}
        />
      </div>
      <div className="cluster" style={{ gap: "var(--s-4)" }}>
        <Field
          id={`${idPrefix}-zipCode`}
          label="ZIP"
          value={value.zipCode}
          onChange={set("zipCode")}
          autoComplete="postal-code"
        />
        <Field
          id={`${idPrefix}-city`}
          label="City"
          value={value.city}
          onChange={set("city")}
          autoComplete="address-level2"
        />
        <Field
          id={`${idPrefix}-country`}
          label="Country"
          value={value.country}
          onChange={set("country")}
          autoComplete="country"
          placeholder="CH"
        />
      </div>
      <Field
        id={`${idPrefix}-contactPhone`}
        label="Phone (optional)"
        value={value.contactPhone ?? ""}
        onChange={set("contactPhone")}
        autoComplete="tel"
      />
    </div>
  );
}
