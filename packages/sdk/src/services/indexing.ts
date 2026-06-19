import type { ClientContext, PaginatedItems } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  IndexConfig,
  IndexConfigCreated,
  IndexPublicConfig,
  ReindexInput,
  ReindexJob,
  ReindexJobInput,
} from "./indexing-types";

export type {
  IndexConfig,
  IndexConfigCreated,
  IndexPublicConfig,
  ReindexInput,
  ReindexJob,
  ReindexJobInput,
  ReindexEntityType,
  ReindexJobStatus,
} from "./indexing-types";

const SERVICE: AuthContext = { kind: "service" };

/** Options for {@link IndexingService.listReindexJobs}. */
export interface ListReindexJobsOptions {
  pageNumber?: number;
  pageSize?: number;
  /** Raw Emporix `q` filter string. */
  q?: string;
}

/**
 * Emporix Indexing Service (`/indexing/{tenant}/…`): search-index provider
 * configurations and reindex. Server-side; defaults to the service token.
 */
export class IndexingService {
  static readonly channel = "indexing" as const;
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/indexing/${this.ctx.tenant}`;
  }

  /** List indexing configurations. */
  async listConfigurations(auth: AuthContext = SERVICE): Promise<IndexConfig[]> {
    return this.ctx.http.request<IndexConfig[]>({ method: "GET", path: `${this.base()}/configurations`, auth });
  }

  /** Get a configuration by provider name. */
  async getConfiguration(provider: string, auth: AuthContext = SERVICE): Promise<IndexConfig> {
    return this.ctx.http.request<IndexConfig>({
      method: "GET",
      path: `${this.base()}/configurations/${encodeURIComponent(provider)}`,
      auth,
    });
  }

  /** Create a configuration. */
  async createConfiguration(input: IndexConfig, auth: AuthContext = SERVICE): Promise<IndexConfigCreated> {
    return this.ctx.http.request<IndexConfigCreated>({
      method: "POST",
      path: `${this.base()}/configurations`,
      auth,
      body: input,
    });
  }

  /** Update a configuration by provider name. */
  async updateConfiguration(provider: string, input: IndexConfig, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `${this.base()}/configurations/${encodeURIComponent(provider)}`,
      auth,
      body: input,
    });
  }

  /** Delete a configuration by provider name. */
  async deleteConfiguration(provider: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/configurations/${encodeURIComponent(provider)}`,
      auth,
    });
  }

  /** List public indexing configurations. */
  async listPublicConfigurations(auth: AuthContext = SERVICE): Promise<IndexPublicConfig[]> {
    return this.ctx.http.request<IndexPublicConfig[]>({ method: "GET", path: `${this.base()}/public/configurations`, auth });
  }

  /** Get a public configuration by provider name. */
  async getPublicConfiguration(provider: string, auth: AuthContext = SERVICE): Promise<IndexPublicConfig> {
    return this.ctx.http.request<IndexPublicConfig>({
      method: "GET",
      path: `${this.base()}/public/configurations/${encodeURIComponent(provider)}`,
      auth,
    });
  }

  /**
   * Create a reindex job (replaces {@link reindex}). A `FULL` reindex of the
   * given `entityType`; set `rag: true` to also rebuild the RAG vector index
   * (PRODUCT only). Resolves to the created job (`201`) or, when a job for that
   * `entityType` is already `IN_PROGRESS`, that running job (`200`).
   */
  async createReindexJob(input: ReindexJobInput, auth: AuthContext = SERVICE): Promise<ReindexJob> {
    return this.ctx.http.request<ReindexJob>({
      method: "POST",
      path: `${this.base()}/reindex-jobs`,
      auth,
      body: input,
    });
  }

  /** List reindex jobs (paginated). */
  async listReindexJobs(
    opts: ListReindexJobsOptions = {},
    auth: AuthContext = SERVICE,
  ): Promise<PaginatedItems<ReindexJob>> {
    const pageNumber = opts.pageNumber ?? 1;
    const pageSize = opts.pageSize ?? 50;
    const query: Record<string, string | number | undefined> = { pageNumber, pageSize };
    if (opts.q !== undefined) query.q = opts.q;
    const items = await this.ctx.http.request<ReindexJob[]>({
      method: "GET",
      path: `${this.base()}/reindex-jobs`,
      query,
      auth,
    });
    return { items, pageNumber, pageSize, hasNextPage: items.length === pageSize };
  }

  /** Fetch one reindex job by id. */
  async getReindexJob(reindexJobId: string, auth: AuthContext = SERVICE): Promise<ReindexJob> {
    return this.ctx.http.request<ReindexJob>({
      method: "GET",
      path: `${this.base()}/reindex-jobs/${encodeURIComponent(reindexJobId)}`,
      auth,
    });
  }

  /**
   * Trigger a reindex.
   * @deprecated since 2026-06-18, removal 2026-12-01 — use {@link createReindexJob}
   * (`createReindexJob({ entityType: "PRODUCT" })`), which returns a trackable job.
   */
  async reindex(input: ReindexInput, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({ method: "POST", path: `${this.base()}/reindex`, auth, body: input });
  }
}
