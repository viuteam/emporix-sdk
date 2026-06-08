import type { MixinSource, RawMixin } from "../types";
import type { JsonSchema } from "../../runtime/types";

/** Fetches schemas from pinned CDN URLs. */
export function cdnManifest(opts: {
  entries: Array<{ key: string; entity: string; version: number; url: string }>;
  fetchImpl?: typeof fetch;
}): MixinSource {
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    async list(): Promise<RawMixin[]> {
      return Promise.all(
        opts.entries.map(async (e) => {
          const r = await doFetch(e.url);
          if (!r.ok) throw new Error(`[emporix-mixins] ${e.key}: ${e.url} → ${r.status}`);
          return { ...e, schema: (await r.json()) as JsonSchema };
        }),
      );
    },
  };
}
