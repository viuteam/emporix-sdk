import { describe, it, expect, vi } from "vitest";
import { readMixin, writeMixin, validateMixin, savedMixinVersion } from "../src/index";
import type { MixinDescriptor } from "../src/index";

const D: MixinDescriptor<{ packaging?: string }> = {
  key: "deliveryOptions",
  entity: "CUSTOMER",
  url: "https://cdn/deliveryOptionsMixIn.v6.json",
  version: 6,
  schema: { type: "object", properties: { packaging: { type: "string" } }, additionalProperties: false },
};

describe("runtime accessor", () => {
  it("writeMixin sets mixins[key] and metadata.mixins[key]=url", () => {
    const body = writeMixin({}, D, { packaging: "Paper" });
    expect(body.mixins).toEqual({ deliveryOptions: { packaging: "Paper" } });
    expect(body.metadata).toEqual({ mixins: { deliveryOptions: D.url } });
  });

  it("writeMixin merges into existing mixins/metadata", () => {
    const existing = { mixins: { other: 1 }, metadata: { mixins: { other: "u" }, version: 2 } };
    const body = writeMixin(existing, D, { packaging: "Box" });
    expect(body.mixins).toEqual({ other: 1, deliveryOptions: { packaging: "Box" } });
    expect(body.metadata).toMatchObject({ version: 2, mixins: { other: "u", deliveryOptions: D.url } });
  });

  it("readMixin returns the typed value or undefined", () => {
    const entity = writeMixin({}, D, { packaging: "Paper" });
    expect(readMixin(entity, D)?.packaging).toBe("Paper");
    expect(readMixin({}, D)).toBeUndefined();
  });

  it("savedMixinVersion parses the version from metadata.mixins url", () => {
    expect(savedMixinVersion({ metadata: { mixins: { deliveryOptions: "x/foo.v3.json" } } }, "deliveryOptions")).toBe(3);
    expect(savedMixinVersion({ metadata: { mixins: { deliveryOptions: "x/foo.v3" } } }, "deliveryOptions")).toBe(3);
    expect(savedMixinVersion({}, "deliveryOptions")).toBeUndefined();
  });

  it("readMixin warns when the saved version differs from the descriptor", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const entity = { mixins: { deliveryOptions: {} }, metadata: { mixins: { deliveryOptions: "x/foo.v5.json" } } };
    readMixin(entity, D);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("validateMixin validates against the schema (lazy ajv)", async () => {
    expect(await validateMixin({ packaging: "Paper" }, D)).toEqual({ valid: true });
    const bad = await validateMixin({ packaging: 42 }, D);
    expect(bad.valid).toBe(false);
    expect(bad.errors?.length).toBeGreaterThan(0);
  });
});
