import type { Address } from "@viu/emporix-sdk";
import { Field, SelectField } from "../components/ui/Field";
import { countryName } from "../lib/countries";

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

export type AddressErrors = Partial<Record<"contactName" | "street" | "zipCode" | "city" | "country", string>>;

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

/** Maps a saved customer `Address` onto an editable `AddressDraft`. */
export function addressToDraft(a: Address): AddressDraft {
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

/** Required fields that are missing, and a country the site does not ship to. */
export function addressErrors(a: AddressDraft, countries: string[]): AddressErrors {
  const e: AddressErrors = {};
  if (!a.contactName.trim()) e.contactName = "Required.";
  if (!a.street.trim()) e.street = "Required.";
  if (!a.zipCode.trim()) e.zipCode = "Required.";
  if (!a.city.trim()) e.city = "Required.";
  if (!a.country) e.country = "Required.";
  else if (countries.length > 0 && !countries.includes(a.country)) {
    e.country = `This site does not ship to ${countryName(a.country)}.`;
  }
  return e;
}

/** One line for summaries: name, street, place, country. */
export function formatAddress(a: AddressDraft): string {
  return [
    a.contactName,
    [a.street, a.streetNumber].filter(Boolean).join(" "),
    [a.zipCode, a.city].filter(Boolean).join(" "),
    a.country ? countryName(a.country) : "",
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * Pure, controlled address field set. The parent owns the draft and receives
 * single-field patches; `idPrefix` keeps ids unique when shipping and billing
 * render on one page. The country is a select over the site's ship-to countries.
 */
export function AddressFields({
  value,
  onChange,
  idPrefix,
  countries = [],
  errors = {},
}: {
  value: AddressDraft;
  onChange: (patch: Partial<AddressDraft>) => void;
  idPrefix: string;
  countries?: string[] | undefined;
  errors?: AddressErrors | undefined;
}) {
  const set =
    (k: keyof AddressDraft) =>
    (e: { target: { value: string } }) =>
      onChange({ [k]: e.target.value });
  // A saved address may name a country the site does not list; keep it
  // selectable so the error can say so instead of the value silently vanishing.
  const options = value.country && !countries.includes(value.country) ? [...countries, value.country] : countries;
  return (
    <div className="form-grid">
      <Field
        id={`${idPrefix}-contactName`}
        label="Contact name"
        required
        value={value.contactName}
        onChange={set("contactName")}
        autoComplete="name"
        error={errors.contactName}
      />
      <Field
        id={`${idPrefix}-companyName`}
        label="Company (optional)"
        value={value.companyName ?? ""}
        onChange={set("companyName")}
        autoComplete="organization"
      />
      <div className="form-grid form-grid--street">
        <Field
          id={`${idPrefix}-street`}
          label="Street"
          required
          value={value.street}
          onChange={set("street")}
          autoComplete="address-line1"
          error={errors.street}
        />
        <Field id={`${idPrefix}-streetNumber`} label="No." value={value.streetNumber ?? ""} onChange={set("streetNumber")} />
      </div>
      <div className="form-grid form-grid--city">
        <Field
          id={`${idPrefix}-zipCode`}
          label="Postcode"
          required
          value={value.zipCode}
          onChange={set("zipCode")}
          autoComplete="postal-code"
          error={errors.zipCode}
        />
        <Field
          id={`${idPrefix}-city`}
          label="City"
          required
          value={value.city}
          onChange={set("city")}
          autoComplete="address-level2"
          error={errors.city}
        />
      </div>
      <div className="field">
        <SelectField id={`${idPrefix}-country`} label="Country" required value={value.country} onChange={set("country")} autoComplete="country">
          <option value="" disabled>
            Choose a country
          </option>
          {options.map((c) => (
            <option key={c} value={c}>
              {countryName(c)}
            </option>
          ))}
        </SelectField>
        {errors.country ? <span className="field__error">{errors.country}</span> : null}
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
