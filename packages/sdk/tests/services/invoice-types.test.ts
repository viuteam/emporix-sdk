import { describe, it, expectTypeOf } from "vitest";
import type { InvoiceJobDraft, InvoiceJobCreated, InvoiceJob } from "../../src/services/invoice-types";

describe("invoice types", () => {
  it("aliases the generated invoice types", () => {
    expectTypeOf<InvoiceJobDraft["jobType"]>().toEqualTypeOf<"AUTOMATIC" | "MANUAL">();
    expectTypeOf<InvoiceJobCreated>().not.toBeNever();
    expectTypeOf<InvoiceJob>().not.toBeNever();
  });
});
