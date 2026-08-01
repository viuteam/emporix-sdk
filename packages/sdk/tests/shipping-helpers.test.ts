import { describe, expect, it } from "vitest";
import { pickFee, resolveZone, type ShippingFee, type Zone } from "../src/index";

/**
 * Fixtures against the generated shapes: `Zone.id`, `Zone.name` and
 * `Zone.shipTo` are all required, as are `ShippingFee.cost` and
 * `ShippingFee.minOrderValue`.
 */
function zone(id: string, countries: string[], isDefault = false): Zone {
  return {
    id,
    name: id,
    shipTo: countries.map((country) => ({ country })),
    ...(isDefault ? { default: true } : {}),
  };
}

function fee(minOrderValue: number, cost: number): ShippingFee {
  return {
    cost: { currency: "CHF", amount: cost },
    minOrderValue: { currency: "CHF", amount: minOrderValue },
  };
}

describe("resolveZone", () => {
  it("returns the zone whose shipTo covers the country", () => {
    const zones = [zone("eu", ["DE", "FR"]), zone("ch", ["CH"])];
    expect(resolveZone(zones, "CH")?.id).toBe("ch");
  });

  it("falls back to the default zone when no shipTo matches", () => {
    const zones = [zone("eu", ["DE"]), zone("rest", ["US"], true)];
    expect(resolveZone(zones, "CH")?.id).toBe("rest");
  });

  it("falls back to the first zone when there is no default either", () => {
    const zones = [zone("eu", ["DE"]), zone("us", ["US"])];
    expect(resolveZone(zones, "CH")?.id).toBe("eu");
  });

  it("returns undefined for an empty or missing list", () => {
    expect(resolveZone([], "CH")).toBeUndefined();
    expect(resolveZone(undefined, "CH")).toBeUndefined();
  });

  it("matches case-insensitively in both directions", () => {
    // The non-matching zone comes FIRST on purpose. With a single zone the
    // `?? zones[0]` fallback returns that same zone, so the assertion would
    // pass even with the case normalization removed — a vacuous test.
    const zones = [zone("eu", ["DE"]), zone("ch", ["ch"])];
    expect(resolveZone(zones, "  Ch ")?.id).toBe("ch");
  });
});

describe("pickFee", () => {
  it("takes the highest threshold at or below the cart total", () => {
    const fees = [fee(0, 10), fee(50, 5), fee(100, 0)];
    expect(pickFee(fees, 75)?.cost.amount).toBe(5);
  });

  it("includes a threshold the total exactly meets", () => {
    // The `<=` vs `<` boundary. A rewrite that drops the equals case ships a
    // customer who hit free-shipping exactly a shipping charge.
    const fees = [fee(0, 10), fee(100, 0)];
    expect(pickFee(fees, 100)?.cost.amount).toBe(0);
  });

  it("falls back to the first fee when the total is below every threshold", () => {
    const fees = [fee(50, 5), fee(100, 0)];
    expect(pickFee(fees, 10)?.cost.amount).toBe(5);
  });

  it("treats a missing minOrderValue as zero", () => {
    // The generated type declares `minOrderValue` REQUIRED, yet the storefront
    // demo guards with `?.amount ?? 0`. This spec has been wrong before — the
    // mixed `sessionId` / `access_token` casing proved it — so the defensive
    // branch stays, and this test stops anyone deleting it as dead code.
    const fees = [{ cost: { currency: "CHF", amount: 7 } } as unknown as ShippingFee, fee(100, 0)];
    expect(pickFee(fees, 5)?.cost.amount).toBe(7);
  });

  it("returns undefined for an empty or missing list", () => {
    expect(pickFee([], 100)).toBeUndefined();
    expect(pickFee(undefined, 100)).toBeUndefined();
  });
});
