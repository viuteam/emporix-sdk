import { describe, expect, it } from "vitest";
import { pathLanguage } from "../app/lib/path-language";

/**
 * The regression test for the language split.
 *
 * Measured on 2026-08-05: the product page `/de/product/…` showed «Just-in-Time
 * Zugriff (JIT)» while the same item in the cart showed «Just-in-Time Access (JIT)».
 * The cause was not where the routes live but that nobody wrote the language cookie
 * as long as the visitor never clicked the switcher. `proxy.ts` now derives the
 * language from the path — and that derivation is where it can break again.
 */
describe("pathLanguage", () => {
  it("reads the language from the first segment", () => {
    expect(pathLanguage("/de")).toBe("de");
    expect(pathLanguage("/en")).toBe("en");
    expect(pathLanguage("/de/categories")).toBe("de");
    expect(pathLanguage("/en/product/abc/2")).toBe("en");
  });

  it("answers null when the path announces no language", () => {
    // The distinction that matters: a session route must not overwrite the visitor's
    // choice, because it says nothing about language.
    expect(pathLanguage("/cart")).toBeNull();
    expect(pathLanguage("/checkout")).toBeNull();
    expect(pathLanguage("/account/orders")).toBeNull();
    expect(pathLanguage("/")).toBeNull();
    expect(pathLanguage("")).toBeNull();
  });

  it("accepts nothing the tenant does not offer", () => {
    // The value lands in a cookie and from there in the `Accept-Language` of every
    // Emporix request the session makes. A path is attacker-controlled.
    expect(pathLanguage("/fr/product/x")).toBeNull();
    expect(pathLanguage("/DE")).toBeNull();
    expect(pathLanguage("/de-CH")).toBeNull();
    expect(pathLanguage("/..%2f")).toBeNull();
  });

  it("does not mistake a session route for a language prefix", () => {
    // `/debug` does not start with «de», even though those two letters are there.
    expect(pathLanguage("/debug")).toBeNull();
    expect(pathLanguage("/design")).toBeNull();
  });
});
