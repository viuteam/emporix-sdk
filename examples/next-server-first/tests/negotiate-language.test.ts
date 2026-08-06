import { describe, expect, it } from "vitest";
import { negotiateLanguage } from "../app/lib/negotiate-language";

const SERVED = ["en", "de"] as const;

describe("negotiateLanguage", () => {
  it("picks the highest-weighted served language", () => {
    expect(negotiateLanguage("en;q=0.8, de;q=0.9", SERVED, "de")).toBe("de");
    expect(negotiateLanguage("de;q=0.2, en;q=0.7", SERVED, "de")).toBe("en");
  });

  it("treats a missing q as 1", () => {
    // `en, de;q=0.9` means English first — the default weight is 1, not 0.
    expect(negotiateLanguage("en, de;q=0.9", SERVED, "de")).toBe("en");
  });

  it("matches a region subtag to its primary language", () => {
    expect(negotiateLanguage("de-CH", SERVED, "en")).toBe("de");
    expect(negotiateLanguage("en-GB,en;q=0.9", SERVED, "de")).toBe("en");
  });

  it("skips languages the tenant does not serve", () => {
    // fr is not served, so the next acceptable one wins rather than the fallback.
    expect(negotiateLanguage("fr;q=1.0, en;q=0.5", SERVED, "de")).toBe("en");
  });

  it("falls back when nothing matches", () => {
    expect(negotiateLanguage("fr, es", SERVED, "de")).toBe("de");
    expect(negotiateLanguage("*", SERVED, "de")).toBe("de");
    expect(negotiateLanguage(null, SERVED, "de")).toBe("de");
    expect(negotiateLanguage("", SERVED, "de")).toBe("de");
  });

  it("survives a malformed header rather than throwing", () => {
    // This value comes off the wire, so it is whatever the client sent.
    expect(negotiateLanguage(";;;q=", SERVED, "de")).toBe("de");
    expect(negotiateLanguage("en;q=notanumber", SERVED, "de")).toBe("en");
  });

  it("is case-insensitive", () => {
    expect(negotiateLanguage("DE-ch", SERVED, "en")).toBe("de");
  });
});
