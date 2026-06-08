import type { HasMixins } from "./types";

/** Parses the version from the entity's `metadata.mixins[key]` URL (e.g. `…MixIn.v6.json` → 6). */
export function savedMixinVersion(entity: HasMixins, key: string): number | undefined {
  const url = entity.metadata?.mixins?.[key];
  if (typeof url !== "string") return undefined;
  const m = url.match(/\.v(\d+)(?:\.\w+)?$/);
  return m ? Number(m[1]) : undefined;
}
