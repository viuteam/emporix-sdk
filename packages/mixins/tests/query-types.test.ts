import { describe, it, expect } from "vitest";
import { mixinQuery, and, or } from "../src/index";
import type { MixinDescriptor, MixinFilter } from "../src/index";

const PRODUCT: MixinDescriptor<{ color?: string; qty?: number }, "PRODUCT"> = {
  key: "attrs",
  entity: "PRODUCT",
  url: "u",
  version: 1,
};
const ORDER: MixinDescriptor<{ priority?: string }, "ORDER"> = {
  key: "ord",
  entity: "ORDER",
  url: "u",
  version: 1,
};

describe("type gating (compile-time)", () => {
  it("propagates the entity onto the filter and gates misuse", () => {
    // Entity literal flows through.
    const p: MixinFilter<"PRODUCT"> = mixinQuery(PRODUCT, { color: "Blue" });
    expect(p.toString()).toBe("mixins.attrs.color:Blue");

    // @ts-expect-error unknown attribute name
    mixinQuery(PRODUCT, { nope: "x" });

    // @ts-expect-error string attribute does not accept numeric range op
    mixinQuery(PRODUCT, { color: { gt: 1 } });

    // @ts-expect-error number attribute does not accept regex op
    mixinQuery(PRODUCT, { qty: { regex: "1" } });

    // @ts-expect-error string attribute cannot equal a number
    mixinQuery(PRODUCT, { color: 5 });

    // @ts-expect-error cannot AND filters from different entities
    and(mixinQuery(PRODUCT, { color: "Blue" }), mixinQuery(ORDER, { priority: "high" }));

    // @ts-expect-error cannot OR filters from different entities
    or(mixinQuery(PRODUCT, { color: "Blue" }), mixinQuery(ORDER, { priority: "high" }));
  });
});
