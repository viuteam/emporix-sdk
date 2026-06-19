import { createHash } from "node:crypto";

/** One vendored spec's provenance in the sync manifest. */
export interface SpecManifestEntry {
  url: string;
  /** `info.version` from the spec (often "" upstream). */
  specVersion: string;
  /** ISO-8601 timestamp of the fetch run that vendored this spec. */
  fetchedAt: string;
  /** sha256 (hex) of the fetched YAML bytes — the change watermark. */
  sha256: string;
}

/** The machine-readable record of which upstream specs are vendored, and when. */
export interface SyncManifest {
  generatedAt: string;
  services: Record<string, SpecManifestEntry>;
}

/** sha256 hex of a spec's raw text. */
export function hashSpec(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Extract `info.version` from a raw OpenAPI YAML — the first two-space-indented
 * `version:` key (which sits under the top-level `info:` block). Returns "" when
 * absent or empty. Informational only; a regex keeps this dependency-free.
 */
export function readSpecVersion(yaml: string): string {
  const m = yaml.match(/^ {2}version:\s*(.*)$/m);
  return (m?.[1] ?? "").trim().replace(/^['"]|['"]$/g, "");
}

/** Service names whose sha256 is new or differs between `prev` and `next`, sorted. */
export function diffManifest(prev: SyncManifest | null, next: SyncManifest): string[] {
  if (!prev) return [];
  const changed: string[] = [];
  for (const [name, entry] of Object.entries(next.services)) {
    const before = prev.services[name];
    if (!before || before.sha256 !== entry.sha256) changed.push(name);
  }
  return changed.sort();
}
