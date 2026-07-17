import { describe, it, expect } from "vitest";
import { applyPatches, SPEC_PATCHES } from "../scripts/spec-patches";

// Minimal reproduction of the upstream schema.yml defects: a dangling
// BulkItemResponses $ref, and the BulkPatchCustomInstanceRequest schema
// mis-indented at 2-space (a paths sibling) wedged between the bulk `post` and
// `put`, which dangles its $ref and re-parents `put` onto a bogus path.
const BROKEN_SCHEMA = [
  "paths:",
  "  '/schema/{tenant}/custom-entities/{type}/instances/bulk':",
  "    patch:",
  "      responses:",
  "        '207':",
  "          content:",
  "            application/json:",
  "              schema:",
  "                $ref: '#/components/schemas/BulkItemResponses'",
  "    post:",
  "      operationId: POST-schema-create-custom-instances-bulk",
  "  BulkPatchCustomInstanceRequest:",
  "    type: object",
  "    required:",
  "      - id",
  "      - data",
  "    properties:",
  "      id:",
  "        type: string",
  "        description: Unique identifier of the custom instance to patch.",
  "      data:",
  "        type: array",
  "        description: List of patch operations to apply to the custom instance.",
  "        items:",
  "          type: object",
  "    put:",
  "      operationId: PUT-schema-upsert-custom-instances-bulk",
  "components:",
  "  schemas:",
  "    BulkResponse:",
  "      type: array",
  "      items:",
  "        type: object",
  "",
].join("\n");

describe("spec-patches", () => {
  it("returns the spec unchanged, with no results, for a spec with no patches", () => {
    const src = "openapi: 3.0.0\n";
    const out = applyPatches("no-such-service", src);
    expect(out.yaml).toBe(src);
    expect(out.applied).toEqual([]);
    expect(out.stale).toEqual([]);
  });

  it("rewrites the dangling BulkItemResponses $ref to BulkResponse", () => {
    const out = applyPatches("schema", BROKEN_SCHEMA);
    expect(out.yaml).toContain("#/components/schemas/BulkResponse");
    expect(out.yaml).not.toContain("BulkItemResponses");
  });

  it("relocates the mis-indented schema out of paths and under components.schemas", () => {
    const out = applyPatches("schema", BROKEN_SCHEMA);
    // `put` re-attaches to its path at 4-space indent, right after `post`.
    expect(out.yaml).toContain(
      "      operationId: POST-schema-create-custom-instances-bulk\n    put:",
    );
    // No 2-space (paths-level) definition remains; exactly one 4-space definition.
    expect(out.yaml).not.toContain("\n  BulkPatchCustomInstanceRequest:");
    expect(out.yaml).toContain("\n    BulkPatchCustomInstanceRequest:\n      type: object");
    // The anchored schema is preserved.
    expect(out.yaml).toContain("    BulkResponse:\n      type: array");
    // A single occurrence — never duplicated.
    expect(out.yaml.split("BulkPatchCustomInstanceRequest:").length - 1).toBe(1);
    expect(out.stale).toEqual([]);
  });

  it("is idempotent: a second pass changes nothing and reports both patches stale", () => {
    const once = applyPatches("schema", BROKEN_SCHEMA);
    const twice = applyPatches("schema", once.yaml);
    expect(twice.yaml).toBe(once.yaml);
    expect(twice.applied).toEqual([]);
    expect(twice.stale).toHaveLength((SPEC_PATCHES.schema ?? []).length);
  });

  it("reports patches as stale (not applied) once upstream is clean — no duplicate insert", () => {
    const clean = ["components:", "  schemas:", "    BulkResponse:", "      type: array", ""].join("\n");
    const out = applyPatches("schema", clean);
    expect(out.applied).toEqual([]);
    expect(out.stale).toHaveLength((SPEC_PATCHES.schema ?? []).length);
    // The relocation patch must NOT fire on already-clean input (would dup).
    expect(out.yaml).not.toContain("BulkPatchCustomInstanceRequest");
  });

  it("only registers patches for confirmed-defective specs", () => {
    expect(Object.keys(SPEC_PATCHES)).toContain("schema");
  });
});
