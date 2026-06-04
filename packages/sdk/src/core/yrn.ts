/**
 * Extracts the product id from a product `itemYrn`
 * (`urn:yaas:hybris:product:product:<tenant>;<productId>`). Cart and order line
 * items carry only the YRN, not a bare product id. Returns "" when the YRN is
 * missing or has no `;` segment.
 */
export function productIdFromYrn(yrn: string | undefined): string {
  if (!yrn) return "";
  const semi = yrn.lastIndexOf(";");
  return semi >= 0 ? yrn.slice(semi + 1) : "";
}
