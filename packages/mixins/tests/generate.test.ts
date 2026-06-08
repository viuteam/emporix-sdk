import { describe, it, expect } from "vitest";
import { buildLock, diffLock } from "../src/codegen/lock";
import { generateTypes } from "../src/codegen/generate";
import type { RawMixin } from "../src/codegen/types";

const RAW: RawMixin[] = [
  {
    key: "deliveryOptions",
    entity: "CUSTOMER",
    version: 6,
    url: "https://cdn/d.v6.json",
    schema: { type: "object", additionalProperties: false, properties: { packaging: { type: "string" } } },
  },
];

describe("lock", () => {
  it("buildLock keys by mixin with version+url+hash; diffLock detects version change", () => {
    const a = buildLock(RAW);
    expect(a.deliveryOptions!.version).toBe(6);
    const bumped = buildLock([{ ...RAW[0]!, version: 7, url: "https://cdn/d.v7.json" }]);
    const drift = diffLock(a, bumped);
    expect(drift).toEqual([{ key: "deliveryOptions", from: 6, to: 7 }]);
    expect(diffLock(a, a)).toEqual([]);
  });
});

describe("generate", () => {
  it("emits a versioned interface + a registry from raw mixins", async () => {
    const files = await generateTypes(RAW);
    const reg = files["registry.ts"]!;
    expect(files["delivery-options.ts"]).toMatch(/DeliveryOptionsMixinV6/);
    expect(reg).toMatch(/export const mixins/);
    expect(reg).toMatch(/deliveryOptions:/);
    expect(reg).toMatch(/MixinDescriptor<DeliveryOptionsMixinV6>/);
  });
});
