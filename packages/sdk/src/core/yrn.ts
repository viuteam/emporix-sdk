/**
 * Extracts the product id from a product `itemYrn`
 * (`urn:yaas:hybris:product:product:<tenant>;<productId>`). Cart and order line
 * items carry only the YRN, not a bare product id. Returns "" when the YRN is
 * missing or has no `;` segment.
 *
 * Approval resource items are an exception: their `itemYrn` is frequently the bare
 * product id with no YRN wrapper, so this returns "" and you want the sibling
 * `itemId` as a fallback. Measured on tenant `viu`, 2026-08-18.
 */
export function productIdFromYrn(yrn: string | undefined): string {
  if (!yrn) return "";
  const semi = yrn.lastIndexOf(";");
  return semi >= 0 ? yrn.slice(semi + 1) : "";
}

/**
 * Builds a product `itemYrn` — the form `carts.addItem` requires.
 *
 * The inverse of {@link productIdFromYrn}. Emporix rejects anything else with
 * «Given yrn does not match yaas urn scheme».
 */
export function productYrn(tenant: string, productId: string): string {
  return `urn:yaas:hybris:product:product:${tenant};${productId}`;
}
