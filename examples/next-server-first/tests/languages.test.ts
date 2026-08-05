import { describe, expect, it } from "vitest";
import { DEFAULT_LANGUAGE, LANGUAGES, isLanguage } from "../app/lib/languages";

describe("isLanguage", () => {
  it("accepts what the tenant offers", () => {
    expect(isLanguage("de")).toBe(true);
    expect(isLanguage("en")).toBe(true);
  });

  it("rejects anything else, including case variants and empties", () => {
    // A route param is attacker-controlled. `/xx/category/…` has to 404 rather
    // than render with a language Emporix has never heard of — and `Accept-
    // Language` is sent verbatim, so an unchecked value reaches the tenant.
    expect(isLanguage("fr")).toBe(false);
    expect(isLanguage("DE")).toBe(false);
    expect(isLanguage("")).toBe(false);
    expect(isLanguage("de-CH")).toBe(false);
  });

  it("defaults to the tenant's default language", () => {
    // `sites.get("main")` returns defaultLanguage: "de" on viu. An unprefixed
    // URL must land on the same language the tenant would have chosen.
    expect(DEFAULT_LANGUAGE).toBe("de");
    expect(LANGUAGES).toContain(DEFAULT_LANGUAGE);
  });
});
