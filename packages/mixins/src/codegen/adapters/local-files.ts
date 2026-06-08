import { readFile } from "node:fs/promises";
import type { MixinSource, RawMixin } from "../types";
import type { JsonSchema } from "../../runtime/types";

/** Reads pre-resolved mixins from local descriptor files: `[{ key, entity, version, url, schemaPath }]`. */
export function localFiles(opts: {
  manifest: Array<{ key: string; entity: string; version: number; url: string; schemaPath: string }>;
}): MixinSource {
  return {
    async list(): Promise<RawMixin[]> {
      return Promise.all(
        opts.manifest.map(async (m) => ({
          key: m.key,
          entity: m.entity,
          version: m.version,
          url: m.url,
          schema: JSON.parse(await readFile(m.schemaPath, "utf8")) as JsonSchema,
        })),
      );
    },
  };
}
