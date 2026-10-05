const regions = new Intl.DisplayNames(undefined, { type: "region" });

/** The display name of an ISO 3166 country code in the browser's language, or the code itself. */
export function countryName(code: string): string {
  try {
    return regions.of(code) ?? code;
  } catch {
    // `of` throws a RangeError for a malformed code.
    return code;
  }
}
