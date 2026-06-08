import type { JsonSchema } from "../../runtime/types";
import type { MixinSource, RawMixin } from "../types";
import { attributesToJsonSchema } from "../attributes-to-jsonschema";

interface SchemaLike {
  id?: string;
  types?: string[];
  metadata?: { version?: number; url?: string };
  attributes?: unknown[];
}
interface SchemaClientLike {
  schemas: {
    listSchemas: (q?: {
      type?: string;
      pageNumber?: number;
      pageSize?: number;
    }) => Promise<{ items: SchemaLike[]; total: number }>;
  };
}
interface AuthLike {
  kind: string;
}

/**
 * Default source: reads the tenant's Schema Service. Per schema, resolves the
 * JSON Schema by fetching `metadata.url` (authoritative); on fetch failure,
 * converts `attributes[]` as a fallback. Emits one RawMixin per entity type.
 */
export function schemaService(opts: {
  client: SchemaClientLike;
  auth?: AuthLike;
  types?: string[];
  fetchImpl?: typeof fetch;
}): MixinSource {
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    async list(): Promise<RawMixin[]> {
      const all: SchemaLike[] = [];
      let page = 1;
      for (;;) {
        const res = await opts.client.schemas.listSchemas({
          pageNumber: page,
          pageSize: 100,
          ...(opts.types?.[0] ? { type: opts.types[0] } : {}),
        });
        all.push(...res.items);
        if (all.length >= res.total || res.items.length === 0) break;
        page += 1;
      }
      const out: RawMixin[] = [];
      for (const s of all) {
        const key = s.id;
        const version = s.metadata?.version;
        const url = s.metadata?.url;
        if (!key || version === undefined || !url) continue;
        let schema: JsonSchema;
        try {
          const r = await doFetch(url);
          if (!r.ok) throw new Error(String(r.status));
          schema = (await r.json()) as JsonSchema;
        } catch {
          console.warn(
            `[emporix-mixins] schema "${key}": url fetch failed, falling back to attribute conversion`,
          );
          schema = attributesToJsonSchema((s.attributes ?? []) as never);
        }
        for (const entity of s.types ?? ["UNKNOWN"]) {
          out.push({ key, entity, version, url, schema });
        }
      }
      return out;
    },
  };
}
