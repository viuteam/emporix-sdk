import { describe, it, expect } from "vitest";
import { productIdFromYrn } from "../../src/core/yrn";

describe("productIdFromYrn", () => {
  it("extracts the product id after the last ';'", () => {
    expect(productIdFromYrn("urn:yaas:hybris:product:product:viu;0f1e2d3c-4b5a")).toBe(
      "0f1e2d3c-4b5a",
    );
  });

  it("returns '' for undefined or a yrn without ';'", () => {
    expect(productIdFromYrn(undefined)).toBe("");
    expect(productIdFromYrn("no-semicolon")).toBe("");
  });
});
