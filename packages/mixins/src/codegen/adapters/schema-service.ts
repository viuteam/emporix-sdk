import type { JsonSchema } from "../../runtime/types";
import type { MixinSource, RawMixin } from "../types";
import { attributesToJsonSchema } from "../attributes-to-jsonschema";

interface SchemaLike {
  id?: string;
  types?: string[];
  metadata?: { version?: number; url?: string };
  attributes?: unknown[];
}
interface PageLike {
  items: SchemaLike[];
  hasNextPage?: boolean;
}
interface SchemaClientLike {
  schemas: {
    listSchemas: (
      q?: { type?: string; pageNumber?: number; pageSize?: number },
      auth?: AuthLike,
    ) => Promise<PageLike>;
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
      const pageSize = 100;
      let page = 1;
      for (;;) {
        const res = await opts.client.schemas.listSchemas(
          { pageNumber: page, pageSize, ...(opts.types?.[0] ? { type: opts.types[0] } : {}) },
          opts.auth,
        );
        all.push(...res.items);
        const more = res.hasNextPage ?? res.items.length === pageSize;
        if (!more || res.items.length === 0) break;
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
