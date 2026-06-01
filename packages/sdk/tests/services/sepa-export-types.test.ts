import { describe, it, expectTypeOf } from "vitest";
import type { SepaJob, SepaJobInput, SepaJobCreated } from "../../src/services/sepa-export-types";

describe("sepa export types", () => {
  it("types are usable", () => {
    expectTypeOf<SepaJob>().not.toBeNever();
    expectTypeOf<SepaJobInput>().not.toBeNever();
    expectTypeOf<SepaJobCreated>().not.toBeNever();
  });
});
