import { describe, expect, it } from "vitest";
import { productIdFromYrn, productYrn } from "../src/index";

describe("productYrn", () => {
  it("builds the form carts.addItem requires", () => {
    expect(productYrn("viu", "105092691")).toBe("urn:yaas:hybris:product:product:viu;105092691");
  });

  it("round-trips with productIdFromYrn", () => {
    expect(productIdFromYrn(productYrn("viu", "105092691"))).toBe("105092691");
  });
});

describe("productIdFromYrn", () => {
  it("extracts the id from a full YRN", () => {
    expect(productIdFromYrn("urn:yaas:hybris:product:product:viu;105092691")).toBe("105092691");
  });

  it('returns "" for a bare id, as an approval item carries it', () => {
    // Measured: an approval's `resource.items[].itemYrn` is often the bare product id
    // with no YRN wrapper. Not a defect in this function — but callers need the
    // sibling `itemId` as a fallback, which the docstring now says.
    expect(productIdFromYrn("105092691")).toBe("");
  });

  it('returns "" for undefined', () => {
    expect(productIdFromYrn(undefined)).toBe("");
  });
});
