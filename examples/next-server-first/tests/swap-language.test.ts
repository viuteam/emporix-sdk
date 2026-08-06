import { describe, expect, it } from "vitest";
import { swapLanguage } from "../app/lib/swap-language";

describe("swapLanguage", () => {
  it("swaps the language segment", () => {
    expect(swapLanguage("/de/category/abc", "en")).toBe("/en/category/abc");
    expect(swapLanguage("/en/product/xyz", "de")).toBe("/de/product/xyz");
    expect(swapLanguage("/de", "en")).toBe("/en");
  });

  it("swaps it on a session route too", () => {
    // The case this function used to have to leave alone. Since the session routes moved
    // under `/[lang]/…` they are ordinary prefixed paths.
    expect(swapLanguage("/de/cart", "en")).toBe("/en/cart");
    expect(swapLanguage("/de/account/orders/42", "en")).toBe("/en/account/orders/42");
  });

  it("sends an unprefixed path to the language home", () => {
    // Only reachable from a 404, where the switcher still renders.
    expect(swapLanguage("/", "en")).toBe("/en");
    expect(swapLanguage("", "de")).toBe("/de");
    expect(swapLanguage("/fr/category/abc", "en")).toBe("/en");
  });
});
