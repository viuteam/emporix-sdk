/**
 * The address fields, defined once because the form renders them and the Server
 * Action reads them back — two lists would drift, and a drifted field name is a
 * 400 whose body names a field you thought you were sending.
 *
 * Taken from `storefront-demo/src/account/AddressForm.tsx`, where the same call
 * runs against the real tenant. A `"use server"` module may only export async
 * functions, which is why this list lives here rather than beside the actions.
 */
export const ADDRESS_FIELDS = [
  { name: "contactName", label: "Contact name", required: true },
  { name: "contactPhone", label: "Phone", required: false },
  { name: "street", label: "Street", required: true },
  { name: "streetNumber", label: "No.", required: false },
  { name: "zipCode", label: "Postcode", required: true },
  { name: "city", label: "City", required: true },
  { name: "country", label: "Country (ISO-2)", required: true },
] as const;

export type AddressField = (typeof ADDRESS_FIELDS)[number]["name"];

/** Reads the form into a flat record, trimmed. */
export function readAddress(form: FormData): Record<AddressField, string> {
  const out = {} as Record<AddressField, string>;
  for (const f of ADDRESS_FIELDS) out[f.name] = String(form.get(f.name) ?? "").trim();
  return out;
}

/**
 * The first missing required field, or `null`.
 *
 * Emporix answers a missing required field with a 400 that names it, so this only
 * saves the round trip — but it also names the field in the form's own words
 * rather than the API's.
 */
export function missingField(address: Record<AddressField, string>): string | null {
  for (const f of ADDRESS_FIELDS) {
    if (f.required && address[f.name] === "") return `${f.label} is required.`;
  }
  return null;
}
