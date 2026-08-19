/**
 * Repairs for known defects in upstream Emporix OpenAPI specs.
 *
 * `fetch-specs.ts` vendors specs verbatim from `emporix/api-references`.
 * Occasionally an upstream spec ships a defect that crashes the whole
 * `generate` step (a dangling `$ref`, a schema mis-indented into `paths:`) or
 * that types an operation so it cannot be called (`approval-service.yml`, whose
 * JSON-Patch `op` enum is uppercase while the live API accepts only lowercase).
 * We can't wait for Emporix to fix their published spec, so we apply narrow,
 * documented text patches to the fetched YAML before it is written and hashed.
 * The vendored spec on disk is therefore already correct, and the manifest
 * sha256 stays stable across runs.
 *
 * Each patch is idempotent: its `apply` returns the repaired text, or `null`
 * when there is nothing to do (defect absent, or already repaired). When a
 * patch stops matching (upstream fixed the defect, or reshaped the surrounding
 * text), `applyPatches` reports it as `stale` so it can be removed — a dead
 * patch is weight, and one that half-applied could hide a re-introduced bug.
 *
 * That removal path is real and has been used: two `schema.yml` patches (the
 * dangling `BulkItemResponses` ref and the mis-indented
 * `BulkPatchCustomInstanceRequest`) went stale once Emporix fixed both upstream,
 * and were dropped on 2026-08-19. Judge staleness from a `fetch:specs` run,
 * which applies patches to the **raw** download — never by inspecting the
 * vendored file, which is post-patch and therefore looks clean either way.
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
 * Per-spec patch registry, keyed by the service name used in `fetch-specs.ts`.
 * Add an entry only for a confirmed upstream defect, with a `reason` that says
 * what is wrong upstream and what the corrected form should be.
 */
export const SPEC_PATCHES: Record<string, SpecPatch[]> = {
  /**
   * The op enum ships uppercase upstream, and the live API rejects it.
   *
   * Measured against tenant `viu` on 2026-08-18: `PATCH /approval/{tenant}/approvals/{id}`
   * with `{ op: "REPLACE", path: "/status" }` answers 400; the same call with
   * `{ op: "replace" }` succeeds. `docs/approval.md` has always shown the lowercase
   * form — it is the generated type that misleads, which is why the repair belongs
   * here rather than in a hand-written cast at each call site.
   *
   * Deliberately NOT applied to `ai-service.yml` (`PatchRequest`) or `quote.yml`
   * (`QuoteUpdateRequest`), which carry the identical uppercase enum: neither has
   * been measured. Lowercasing an op that a service expects uppercase breaks working
   * calls in the other direction, so each needs its own confirmed 400 first.
   */
  "approval-service": [
    {
      reason:
        "upstream: the JSON-Patch `op` enum is uppercase (ADD/REMOVE/REPLACE); the live API rejects those with 400 and accepts only lowercase. Lowercasing the enum is what makes the generated `ApprovalPatch['op']` usable.",
      apply: replaceAll(
        "              - enum:\n                  - ADD\n                  - REMOVE\n                  - REPLACE",
        "              - enum:\n                  - add\n                  - remove\n                  - replace",
      ),
    },
    {
      reason:
        "upstream: the `approvalUpdateBody` examples repeat the same uppercase ops. They do not affect codegen, but a vendored spec whose examples contradict its own enum is a trap for the next reader.",
      apply: (yaml) => {
        const next = yaml.split("- op: REPLACE").join("- op: replace").split("- op: ADD").join("- op: add");
        return next === yaml ? null : next;
      },
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
