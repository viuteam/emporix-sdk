import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type { MetadataFilter, RagType } from "./ai-rag-indexer-types";

export type { MetadataFilter, RagType } from "./ai-rag-indexer-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * AI RAG Indexer (`/ai-rag-indexer/{tenant}/{type}`). Read which fields the RAG
 * index embeds / can filter on, and trigger a full asynchronous rebuild.
 *
 * Requires the backend-only `ai.agent_read` (reads) / `ai.agent_manage`
 * (`reindex`) scopes — default auth: service. **Server-side use only**; the
 * service token must never reach a browser.
 *
 * Quirks: only `PRODUCT` exists today (the `type` arg defaults to it);
 * `reindex` is a **full** rebuild (no delta), runs **asynchronously**, returns
 * `204` once *scheduled* (not on completion), has **no status endpoint** to
 * poll, and is costly — call it sparingly. The set of embedded fields is
 * configured in the AI Service, not here.
 */
export class RagIndexerService {
  constructor(private readonly ctx: ClientContext) {}

  private base(type: RagType): string {
    return `/ai-rag-indexer/${this.ctx.tenant}/${encodeURIComponent(type)}`;
  }

  /** The indexable embedding field names for `type` (default `"PRODUCT"`). */
  async ragMetadata(type: RagType = "PRODUCT", auth: AuthContext = SERVICE): Promise<string[]> {
    return this.ctx.http.request<string[]>({
      method: "GET",
      path: `${this.base(type)}/rag-metadata`,
      auth,
    });
  }

  /** The filterable metadata fields for `type` (default `"PRODUCT"`). */
  async filterMetadata(
    type: RagType = "PRODUCT",
    auth: AuthContext = SERVICE,
  ): Promise<MetadataFilter[]> {
    return this.ctx.http.request<MetadataFilter[]>({
      method: "GET",
      path: `${this.base(type)}/filter-metadata`,
      auth,
    });
  }

  /**
   * Schedule a full asynchronous re-index for `type` (default `"PRODUCT"`).
   * Resolves once the rebuild is *scheduled* (HTTP 204); there is no progress
   * to await or poll. Costly — avoid calling on a hot path.
   */
  async reindex(type: RagType = "PRODUCT", auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "POST",
      path: `${this.base(type)}/reindex`,
      auth,
    });
  }
}
