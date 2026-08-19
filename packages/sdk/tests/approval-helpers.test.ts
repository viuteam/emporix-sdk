import { describe, expect, it } from "vitest";
import { approvalStatusPatch } from "../src/index";

/**
 * Imported through `../src/index` rather than the service module, so this also
 * asserts the helper is part of the public surface.
 */
describe("approvalStatusPatch", () => {
  it("builds the status change as a lowercase replace", () => {
    expect(approvalStatusPatch("APPROVED")).toEqual([
      { op: "replace", path: "/status", value: "APPROVED" },
    ]);
  });

  it("uses add for the approver comment, not replace", () => {
    // The point of this helper. `replace` on /approverComment answers
    // APPROVAL-400010 «Missing field "approverComment"» because the field does not
    // exist on a fresh approval — and since PATCH is atomic, that failure drops the
    // status change with it. Measured against tenant `viu`, 2026-08-18.
    expect(approvalStatusPatch("DECLINED", "Quantity too high")).toEqual([
      { op: "replace", path: "/status", value: "DECLINED" },
      { op: "add", path: "/approverComment", value: "Quantity too high" },
    ]);
  });

  it("omits the comment operation when there is no comment", () => {
    expect(approvalStatusPatch("CLOSED")).toHaveLength(1);
    expect(approvalStatusPatch("CLOSED", "")).toHaveLength(1);
    expect(approvalStatusPatch("CLOSED", "   ")).toHaveLength(1);
  });

  it("trims the comment rather than sending surrounding whitespace", () => {
    expect(approvalStatusPatch("APPROVED", "  fine  ")).toEqual([
      { op: "replace", path: "/status", value: "APPROVED" },
      { op: "add", path: "/approverComment", value: "fine" },
    ]);
  });

  it("keeps status and comment in ONE patch", () => {
    // Two calls would mean a rejection can land without its reason if the second
    // fails. Atomicity is an advantage here.
    expect(approvalStatusPatch("DECLINED", "Budget exhausted")).toHaveLength(2);
  });
});
