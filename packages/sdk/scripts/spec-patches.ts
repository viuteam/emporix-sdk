/**
 * Repairs for known defects in upstream Emporix OpenAPI specs.
 *
 * `fetch-specs.ts` vendors specs verbatim from `emporix/api-references`.
 * Occasionally an upstream spec ships a defect that crashes the whole
 * `generate` step — a dangling `$ref`, or (as with `schema.yml`) a schema
 * mis-indented into `paths:` so it neither resolves nor lets its sibling
 * operation parse. We can't wait for Emporix to fix their published spec, so we
 * apply narrow, documented text patches to the fetched YAML before it is
 * written and hashed. The vendored spec on disk is therefore already correct,
 * and the manifest sha256 stays stable across runs.
 *
 * Each patch is idempotent: its `apply` returns the repaired text, or `null`
 * when there is nothing to do (defect absent, or already repaired). When a
 * patch stops matching (upstream fixed the defect, or reshaped the surrounding
 * text), `applyPatches` reports it as `stale` so it can be removed — a dead
 * patch is weight, and one that half-applied could hide a re-introduced bug.
 */

/** A single, self-contained, idempotent repair applied to one fetched spec. */
export interface SpecPatch {
  /** Why the patch exists — surfaced in sync logs and PR review. */
  reason: string;
  /** Repair `yaml`; return the patched text, or `null` when nothing to do. */
  apply: (yaml: string) => string | null;
}

/** Exact string replacement of every occurrence; `null` when `find` is absent. */
function replaceAll(find: string, replace: string): (yaml: string) => string | null {
  return (yaml) => (yaml.includes(find) ? yaml.split(find).join(replace) : null);
}

/**
 * The `BulkPatchCustomInstanceRequest` schema as upstream mis-placed it: at
 * 2-space indent (a `paths:` sibling) wedged between the bulk `post` and `put`
 * operations. As written it makes `#/components/schemas/BulkPatchCustomInstanceRequest`
 * dangle AND re-parents the `put` bulk-upsert operation onto a bogus path.
 */
const MISPLACED_BULK_PATCH_SCHEMA = [
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
].join("\n");

/** The same schema, correctly indented for `components.schemas`. */
const RELOCATED_BULK_PATCH_SCHEMA = [
  "    BulkPatchCustomInstanceRequest:",
  "      type: object",
  "      required:",
  "        - id",
  "        - data",
  "      properties:",
  "        id:",
  "          type: string",
  "          description: Unique identifier of the custom instance to patch.",
  "        data:",
  "          type: array",
  "          description: List of patch operations to apply to the custom instance.",
  "          items:",
  "            type: object",
].join("\n");

/** Anchor: the first defined schema (`BulkResponse`) under `components.schemas`. */
const BULK_RESPONSE_ANCHOR = "    BulkResponse:\n      type: array";

/**
 * Relocate `BulkPatchCustomInstanceRequest` from its bogus `paths:` position to
 * `components.schemas`, in one atomic step so the two edits can never drift
 * apart. Idempotent and self-guarding: it only fires while the mis-placed block
 * is present, so it can never insert a duplicate definition. Bails (returns
 * `null`, leaving the defect for the smoke gate to catch loudly) if the anchor
 * is missing, rather than remove the block without re-homing it.
 */
function relocateBulkPatchSchema(yaml: string): string | null {
  const misplaced = `\n${MISPLACED_BULK_PATCH_SCHEMA}`;
  if (!yaml.includes(misplaced)) return null; // defect absent or already fixed
  if (!yaml.includes(BULK_RESPONSE_ANCHOR)) return null; // no safe place to re-home
  // Drop the mis-placed copy — the leading "\n" is consumed so the preceding
  // operation joins directly to the trailing `    put:` line, re-attaching it.
  const removed = yaml.split(misplaced).join("");
  return removed.split(BULK_RESPONSE_ANCHOR).join(`${RELOCATED_BULK_PATCH_SCHEMA}\n${BULK_RESPONSE_ANCHOR}`);
}

/**
 * Per-spec patch registry, keyed by the service name used in `fetch-specs.ts`.
 * Add an entry only for a confirmed upstream defect, with a `reason` that says
 * what is wrong upstream and what the corrected form should be.
 */
export const SPEC_PATCHES: Record<string, SpecPatch[]> = {
  schema: [
    {
      reason:
        "upstream: bulk-patch 207 response $refs the undefined schema 'BulkItemResponses'; the intended target is 'BulkResponse' (its array-of-items shape matches the response example).",
      apply: replaceAll("#/components/schemas/BulkItemResponses", "#/components/schemas/BulkResponse"),
    },
    {
      reason:
        "upstream: schema 'BulkPatchCustomInstanceRequest' is mis-indented into paths: (2-space) — its $ref dangles and it swallows the sibling 'put' bulk-upsert operation. Move it under components.schemas so both the $ref resolves and 'put' re-attaches to its path.",
      apply: relocateBulkPatchSchema,
    },
  ],
};

/** Result of applying every registered patch for a spec. */
export interface PatchOutcome {
  yaml: string;
  /** Reasons of patches that changed the spec. */
  applied: string[];
  /** Patches that made no change — candidates for removal. */
  stale: SpecPatch[];
}

/**
 * Apply every registered patch for `name` to `yaml`, in order. Patches are
 * independent and idempotent; one that changes nothing is reported in `stale`
 * rather than throwing, so an obsolete patch never blocks a sync.
 */
export function applyPatches(name: string, yaml: string): PatchOutcome {
  const patches = SPEC_PATCHES[name] ?? [];
  const applied: string[] = [];
  const stale: SpecPatch[] = [];
  let out = yaml;
  for (const patch of patches) {
    const next = patch.apply(out);
    if (next !== null && next !== out) {
      out = next;
      applied.push(patch.reason);
    } else {
      stale.push(patch);
    }
  }
  return { yaml: out, applied, stale };
}
