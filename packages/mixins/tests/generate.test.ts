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
    expect(reg).toMatch(/"deliveryOptions":/); // quoted key
    expect(reg).toMatch(/MixinDescriptor<DeliveryOptionsMixinV6, "CUSTOMER">/);
  });

  it("produces valid identifiers + quoted keys for id-keyed schemas; registry matches the emitted name", async () => {
    const files = await generateTypes([
      { key: "68e27d7a68ce91215abc0f23", entity: "UNKNOWN", version: 1, url: "https://cdn/x_v1.json",
        schema: { type: "object", additionalProperties: false, properties: { a: { type: "string" } } } },
    ]);
    const typeFile = files["68e27d7a68ce91215abc0f23.ts"]!;
    const reg = files["registry.ts"]!;
    const emitted = typeFile.match(/export interface (\w+)/)![1]!;
    expect(emitted).toMatch(/^Mixin68/); // valid identifier (id keys can't start a TS name)
    expect(reg).toContain(`"68e27d7a68ce91215abc0f23":`); // quoted registry key
    expect(reg).toContain(`MixinDescriptor<${emitted}, "UNKNOWN">`); // registry references the EMITTED name + entity
  });
});
