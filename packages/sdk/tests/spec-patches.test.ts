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
    // upstream; `approval-service` and `cart` are what remains under active repair.
    expect(Object.keys(SPEC_PATCHES).sort()).toEqual(["approval-service", "cart"]);
  });
});

// The request `itemType`, then `priceRow` (the price Emporix returns) followed by
// `priceRowItem` (the price of a cart-item request) and the start of the next
// schema, as vendored on 2026-11-10. Descriptions of the price rows are shortened;
// indentation, the `itemType` block and the `required` lists are verbatim.
const CART_DEFECTS = [
  "  schemas:",
  "    cartItemRequest:",
  "      properties:",
  "        itemType:",
  "          allOf:",
  "            - $ref: '#/components/schemas/itemType'",
  "            - type: object",
  "              description: Optional field which allows fetching external prices if set to EXTERNAL.",
  "    priceRow:",
  "      type: object",
  "      properties:",
  "        priceId:",
  "          type: string",
  "      required:",
  "        - priceId",
  "        - originalAmount",
  "        - effectiveAmount",
  "        - currency",
  "    priceRowItem:",
  "      type: object",
  "      description: Price details.",
  "      properties:",
  "        priceId:",
  "          type: string",
  "          description: This field should not be provided when itemType is EXTERNAL.",
  "      required:",
  "        - priceId",
  "        - originalAmount",
  "        - effectiveAmount",
  "        - currency",
  "    product:",
  "      type: object",
  "",
].join("\n");

/** The `required` list of the schema `name`, read back out of the YAML. */
function requiredOf(yaml: string, name: string): string[] {
  const block = yaml.split(`\n    ${name}:\n`)[1]?.split(/\n {4}\S/)[0] ?? "";
  return [...block.matchAll(/^ {8}- (\S+)$/gm)].map((m) => m[1] as string);
}

describe("cart patches", () => {
  it("drops priceId from the request price, so an external item can omit it", () => {
    const out = applyPatches("cart", CART_DEFECTS);
    expect(requiredOf(out.yaml, "priceRowItem")).toEqual(["originalAmount", "effectiveAmount", "currency"]);
  });

  it("leaves the returned price alone", () => {
    const out = applyPatches("cart", CART_DEFECTS);
    expect(requiredOf(out.yaml, "priceRow")).toEqual(["priceId", "originalAmount", "effectiveAmount", "currency"]);
  });

  it("unwraps the request itemType from its object intersection and keeps the description", () => {
    const out = applyPatches("cart", CART_DEFECTS);
    expect(out.yaml).toContain(
      "            - $ref: '#/components/schemas/itemType'\n            - description: Optional field",
    );
    expect(out.yaml).not.toContain("- type: object");
  });

  it("is idempotent: a second pass changes nothing and reports every patch stale", () => {
    const once = applyPatches("cart", CART_DEFECTS);
    const twice = applyPatches("cart", once.yaml);
    expect(once.applied).toHaveLength(2);
    expect(twice.yaml).toBe(once.yaml);
    expect(twice.stale).toHaveLength(2);
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
