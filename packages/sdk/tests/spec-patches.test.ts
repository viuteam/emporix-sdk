import { describe, it, expect } from "vitest";
import { applyPatches, SPEC_PATCHES } from "../scripts/spec-patches";
import { SPECS } from "../scripts/fetch-specs";

describe("spec-patches", () => {
  it("returns the spec unchanged, with no results, for a spec with no patches", () => {
    const src = "openapi: 3.0.0\n";
    const out = applyPatches("no-such-service", src);
    expect(out.yaml).toBe(src);
    expect(out.applied).toEqual([]);
    expect(out.stale).toEqual([]);
  });

  it("only registers patches for confirmed-defective specs", () => {
    // The two `schema.yml` patches lived here until Emporix fixed both defects
    // upstream; `approval-service` is what remains under active repair.
    expect(Object.keys(SPEC_PATCHES)).toContain("approval-service");
  });
});

// The op enum exactly as upstream ships it — 14 spaces before `- enum:`, 18 before
// the values — plus the `approvalUpdateBody` examples, which repeat the same
// uppercase ops. Both are reproduced verbatim from specs/approval-service.yml as
// fetched on 2026-08-18.
const APPROVAL_UPPERCASE_OPS = [
  "    updateApprovalRequest:",
  "      type: array",
  "      description: Approval partial update operation list.",
  "      items:",
  "        type: object",
  "        properties:",
  "          op:",
  "            anyOf:",
  "              - enum:",
  "                  - ADD",
  "                  - REMOVE",
  "                  - REPLACE",
  "            type: string",
  "    approvalUpdateBody:",
  "      examples:",
  "        Change status of the approval:",
  "          value:",
  "            - op: REPLACE",
  "              path: /status",
  "              value: APPROVED",
  "        Add comment by the approver:",
  "          value:",
  "            - op: ADD",
  "              path: /approverComment",
  "              value: new comment",
  "",
].join("\n");

describe("approval-service patches", () => {
  it("lowercases the op enum so the generated type matches the API", () => {
    const out = applyPatches("approval-service", APPROVAL_UPPERCASE_OPS);
    expect(out.yaml).toContain(
      "              - enum:\n                  - add\n                  - remove\n                  - replace",
    );
    expect(out.yaml).not.toContain("                  - REPLACE");
    expect(out.applied.length).toBeGreaterThan(0);
  });

  it("lowercases the examples too, so the vendored spec does not contradict itself", () => {
    const out = applyPatches("approval-service", APPROVAL_UPPERCASE_OPS);
    expect(out.yaml).toContain("- op: replace");
    expect(out.yaml).toContain("- op: add");
    expect(out.yaml).not.toContain("op: REPLACE");
    expect(out.yaml).not.toContain("op: ADD");
  });

  it("is idempotent: a second pass changes nothing and reports the patches stale", () => {
    const once = applyPatches("approval-service", APPROVAL_UPPERCASE_OPS);
    const twice = applyPatches("approval-service", once.yaml);
    expect(twice.yaml).toBe(once.yaml);
    expect(twice.applied).toEqual([]);
    expect(twice.stale).toHaveLength(once.applied.length);
  });

  it("leaves the path enum and the status values alone", () => {
    // `/status` and `APPROVED` are measured correct as they stand. Lowercasing too
    // broadly would be a new defect, not a fix.
    const out = applyPatches("approval-service", APPROVAL_UPPERCASE_OPS);
    expect(out.yaml).toContain("path: /status");
    expect(out.yaml).toContain("value: APPROVED");
  });
});

describe("SPEC_PATCHES keys", () => {
  it("only names specs that fetch-specs actually fetches", () => {
    // `applyPatches` reads SPEC_PATCHES[name] and returns an empty list for an
    // unknown key — no error, no warning. A typo in the key therefore makes the
    // patch a no-op and nothing says so. This test says so. (The key for the
    // approval service is "approval-service", not "approval".)
    const known = Object.keys(SPECS);
    for (const key of Object.keys(SPEC_PATCHES)) {
      expect(known, `unknown spec key "${key}" in SPEC_PATCHES`).toContain(key);
    }
  });
});
