import { describe, it, expectTypeOf } from "vitest";
import type { Label, LabelList, LabelInput, LabelUpdate } from "../../src/services/label-types";

describe("label types", () => {
  it("Label and LabelList are usable", () => {
    expectTypeOf<Label>().not.toBeNever();
    expectTypeOf<LabelList>().toBeArray();
  });
  it("LabelInput / LabelUpdate are usable as bodies", () => {
    expectTypeOf<LabelInput>().not.toBeNever();
    expectTypeOf<LabelUpdate>().not.toBeNever();
  });
});
