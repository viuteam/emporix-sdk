import { describe, expect, it } from "vitest";
import { swapLanguage } from "../app/lib/swap-language";

describe("swapLanguage", () => {
  it("swaps the language segment of a catalog path", () => {
    expect(swapLanguage("/de/category/abc", "en")).toBe("/en/category/abc");
    expect(swapLanguage("/en/product/xyz", "de")).toBe("/de/product/xyz");
    expect(swapLanguage("/de", "en")).toBe("/en");
  });

  it("leaves a session route alone — those read the cookie, not the URL", () => {
    // Prefixing them would 404: there is no /en/cart route, on purpose.
    expect(swapLanguage("/cart", "en")).toBe("/cart");
    expect(swapLanguage("/account/orders/42", "de")).toBe("/account/orders/42");
    expect(swapLanguage("/search", "en")).toBe("/search");
  });

  it("sends the bare root straight to the language, skipping the redirect", () => {
    expect(swapLanguage("/", "en")).toBe("/en");
    expect(swapLanguage("", "de")).toBe("/de");
  });

  it("does not treat an unknown first segment as a language", () => {
    // /checkout must not become /en/checkout just because it sits where a
    // language segment would.
    expect(swapLanguage("/checkout/done", "en")).toBe("/checkout/done");
    expect(swapLanguage("/fr/category/abc", "en")).toBe("/fr/category/abc");
  });

  it("keeps a query string out of its business", () => {
    // usePathname() never includes one, so the function must not invent handling
    // for something it cannot receive.
    expect(swapLanguage("/de/product/x", "en")).toBe("/en/product/x");
  });
});
