import type { ClientContext, PaginatedItems } from "../core/context";
import { requestPage, type PageParams } from "../core/paged";
import type { AuthContext } from "../core/auth";
import type {
  FilterNode,
  IndexExportPackage,
  IndexField,
  IndexImportResult,
  IndexJob,
  IndexRequest,
  IndexSelection,
  JobId,
  QueryNode,
  SavedQuery,
  SavedQueryId,
  SavedQueryRequest,
  SearchHit as GenSearchHit,
  SearchIndex as GenSearchIndex,
  SearchPost,
} from "../generated/search-service";

/** A matching document. Stored fields come back as stored, plus `id` and `_score`. */
export type SearchHit = GenSearchHit;
/**
 * Body of {@link SearchService.search}: a direct search (`index` plus `queries`,
 * `filters` or both) or a saved-search call (`searchQueryId` plus `query`).
 */
export type SearchInput = SearchPost;
/** One query node: an `and` group, an `or` group, or one query. */
export type SearchQueryNode = QueryNode;
/** One filter node: an `and` group, an `or` group, or one comparison. */
export type SearchFilterNode = FilterNode;
/** A stored saved search. The request field `index` comes back as `indexId`. */
export type SavedSearch = SavedQuery;
/** Body of {@link SearchService.upsertSavedSearch}. */
export type SavedSearchInput = SavedQueryRequest;
/** `201` response of {@link SearchService.upsertSavedSearch}. */
export type SavedSearchCreated = SavedQueryId;
/** A search index on one custom schema type. */
export type SearchIndex = GenSearchIndex;
/** Body of {@link SearchService.upsertIndex}. */
export type SearchIndexInput = IndexRequest;
/** One field of a search index. */
export type SearchIndexField = IndexField;
/** An index build or deletion job. */
export type SearchIndexJob = IndexJob;
/** The id of the job an index write started. */
export type SearchIndexJobRef = JobId;
/** One index to export: `{ type, id }`. */
export type SearchIndexSelection = IndexSelection;
/**
 * Exported index configuration: `exportedAt` plus `data`, a base64-encoded JSON
 * array. {@link SearchService.importIndexes} takes it back unchanged.
 */
export type SearchIndexExport = IndexExportPackage;
/** Result for one imported index. `jobId` and `jobType` are present when a build job started. */
export type SearchIndexImportResult = IndexImportResult;

/** Paging, sort, filter and projection for the list reads. */
export interface SearchListOptions {
  pageNumber?: number;
  /** Defaults to 60, the server's default. */
  pageSize?: number;
  /** `field`, `field:ASC` or `field:DESC`, comma-separated. Default: `metadata.createdAt` descending. */
  sort?: string;
  /** Raw Emporix `q` filter string. */
  q?: string;
  /** Comma-separated properties to return. */
  fields?: string;
  /** Ask for `X-Total-Count` — becomes a request header, not a query parameter. */
  totalCount?: boolean;
}

/** Options for {@link SearchService.listSavedSearches} and {@link SearchService.listIndexes}. */
export interface SearchTypeListOptions extends SearchListOptions {
  /** One custom schema type. Omitted, the list spans every custom schema type, and each item carries `type`. */
  type?: string;
}

/**
 * Options for {@link SearchService.search}. Without `sort`, hits are ordered by
 * relevance; without `fields`, each hit carries `_score`.
 */
export type SearchOptions = Omit<SearchListOptions, "q">;

const SERVICE: AuthContext = { kind: "service" };

function pageQuery(opts: SearchListOptions): { query: Record<string, string | number>; page: PageParams } {
  const pageNumber = opts.pageNumber ?? 1;
  const pageSize = opts.pageSize ?? 60;
  const query: Record<string, string | number> = { pageNumber, pageSize };
  if (opts.sort !== undefined) query.sort = opts.sort;
  if (opts.q !== undefined) query.q = opts.q;
  if (opts.fields !== undefined) query.fields = opts.fields;
  const page: PageParams = {
    pageNumber,
    pageSize,
    ...(opts.totalCount === undefined ? {} : { totalCount: opts.totalCount }),
  };
  return { query, page };
}

/**
 * Emporix Search Service (`/search/{tenant}/…`, **preview**): searches the
 * documents of a custom schema type, stores saved searches, and manages the
 * search indexes and the jobs that build them. Only custom schema types are
 * supported so far. Server-side; defaults to the service token.
 *
 * Scopes: `search.search_read` for every read and for `search`,
 * `search.search_manage` for every write. Searching also needs read access to
 * the documents themselves (`schema.custominstance_read`, `custom.{type}_read`
 * or `custom.{type}_read_own`), or it answers `403`.
 */
export class SearchService {
  static readonly channel = "search" as const;
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/search/${this.ctx.tenant}`;
  }

  /**
   * Search the documents of one custom schema type. Paging, `sort` and
   * `fields` travel as query parameters, not in the body.
   *
   * Filter and sort fields must be indexed on the index the search uses, or the
   * call answers `400`. A saved-search call (`{ searchQueryId, query }`) answers
   * `404` when no saved search has that id for `type`, and `502` means the
   * Schema Service could not confirm that `type` is a custom entity.
   *
   * @example
   * const hits = await client.search.search("vehicle", {
   *   index: "vehicles",
   *   queries: [{ type: "TEXT", query: "diesel", field: "name.en" }],
   *   filters: { field: "status", operator: "EQ", value: "ACTIVE" },
   * });
   */
  async search(
    type: string,
    input: SearchInput,
    opts: SearchOptions = {},
    auth: AuthContext = SERVICE,
  ): Promise<PaginatedItems<SearchHit>> {
    const { query, page } = pageQuery(opts);
    return requestPage<SearchHit>(
      this.ctx.http,
      {
        method: "POST",
        path: `${this.base()}/search/${encodeURIComponent(type)}`,
        auth,
        query,
        body: input,
        idempotent: true, // pure read over POST — safe to replay on 5xx/429
      },
      page,
    );
  }

  /** List saved searches of one custom schema type (`opts.type`), or of every type. */
  async listSavedSearches(
    opts: SearchTypeListOptions = {},
    auth: AuthContext = SERVICE,
  ): Promise<PaginatedItems<SavedSearch>> {
    const { query, page } = pageQuery(opts);
    const t = opts.type;
    return requestPage<SavedSearch>(
      this.ctx.http,
      {
        method: "GET",
        path: t === undefined ? `${this.base()}/search/queries` : `${this.base()}/search/${encodeURIComponent(t)}/queries`,
        auth,
        query,
      },
      page,
    );
  }

  /** Fetch one saved search. */
  async getSavedSearch(
    type: string,
    id: string,
    opts: { fields?: string } = {},
    auth: AuthContext = SERVICE,
  ): Promise<SavedSearch> {
    return this.ctx.http.request<SavedSearch>({
      method: "GET",
      path: `${this.base()}/search/${encodeURIComponent(type)}/queries/${encodeURIComponent(id)}`,
      auth,
      ...(opts.fields === undefined ? {} : { query: { fields: opts.fields } }),
    });
  }

  /**
   * Create or replace a saved search. Resolves to `{ id }` when it was created
   * (`201`) and to `undefined` when it replaced an existing one (`204`).
   *
   * A replace needs the stored `metadata.version` — `400` without it, `409`
   * when it is stale. `index` must already exist for `type` (`404`
   * otherwise). Saving does not start an index build.
   */
  async upsertSavedSearch(
    type: string,
    id: string,
    input: SavedSearchInput,
    auth: AuthContext = SERVICE,
  ): Promise<SavedSearchCreated | undefined> {
    return this.ctx.http.request<SavedSearchCreated | undefined>({
      method: "PUT",
      path: `${this.base()}/search/${encodeURIComponent(type)}/queries/${encodeURIComponent(id)}`,
      auth,
      body: input,
    });
  }

  /** Delete a saved search. Does not start an index build. */
  async deleteSavedSearch(type: string, id: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/search/${encodeURIComponent(type)}/queries/${encodeURIComponent(id)}`,
      auth,
    });
  }

  /** List search indexes of one custom schema type (`opts.type`), or of every type. */
  async listIndexes(
    opts: SearchTypeListOptions = {},
    auth: AuthContext = SERVICE,
  ): Promise<PaginatedItems<SearchIndex>> {
    const { query, page } = pageQuery(opts);
    const t = opts.type;
    return requestPage<SearchIndex>(
      this.ctx.http,
      {
        method: "GET",
        path: t === undefined ? `${this.base()}/search/indexes` : `${this.base()}/search/${encodeURIComponent(t)}/indexes`,
        auth,
        query,
      },
      page,
    );
  }

  /** Fetch one search index. */
  async getIndex(
    type: string,
    id: string,
    opts: { fields?: string } = {},
    auth: AuthContext = SERVICE,
  ): Promise<SearchIndex> {
    return this.ctx.http.request<SearchIndex>({
      method: "GET",
      path: `${this.base()}/search/${encodeURIComponent(type)}/indexes/${encodeURIComponent(id)}`,
      auth,
      ...(opts.fields === undefined ? {} : { query: { fields: opts.fields } }),
    });
  }

  /**
   * Create or update a search index. Resolves to the id of the job that builds
   * it (`202`) — for a new index, a changed field list, or an index whose
   * status is `building` or `failed` — and to `undefined` (`204`) when the
   * index is `ready` and its fields are unchanged; `name` and `description`
   * still change then. Track the job with {@link getJob}.
   *
   * `metadata.version` is optional on an update too. When sent, it is an
   * optimistic lock: a stale one answers `409`, as does a job that is already
   * running for this index.
   */
  async upsertIndex(
    type: string,
    id: string,
    input: SearchIndexInput,
    auth: AuthContext = SERVICE,
  ): Promise<SearchIndexJobRef | undefined> {
    return this.ctx.http.request<SearchIndexJobRef | undefined>({
      method: "PUT",
      path: `${this.base()}/search/${encodeURIComponent(type)}/indexes/${encodeURIComponent(id)}`,
      auth,
      body: input,
    });
  }

  /**
   * Start deleting a search index. Resolves to the id of the job that removes
   * it (`202`); `409` means a job for this index is already running.
   */
  async deleteIndex(type: string, id: string, auth: AuthContext = SERVICE): Promise<SearchIndexJobRef> {
    return this.ctx.http.request<SearchIndexJobRef>({
      method: "DELETE",
      path: `${this.base()}/search/${encodeURIComponent(type)}/indexes/${encodeURIComponent(id)}`,
      auth,
    });
  }

  /**
   * Export the configuration of the selected indexes as one package, to be
   * imported on another tenant with {@link importIndexes}. The decoded `data`
   * holds `id`, `type`, `fields` and the optional `name` and `description` of
   * each index, not its `status` or `metadata`. `404` when a selected index does
   * not exist, `400` for an empty selection.
   */
  async exportIndexes(selections: SearchIndexSelection[], auth: AuthContext = SERVICE): Promise<SearchIndexExport> {
    return this.ctx.http.request<SearchIndexExport>({
      method: "POST",
      path: `${this.base()}/search/indexes/export`,
      auth,
      body: selections,
      idempotent: true, // pure read over POST — safe to replay on 5xx/429
    });
  }

  /**
   * Create or update every index in a package from {@link exportIndexes}, with
   * the same checks as {@link upsertIndex}. Resolves to one result per index,
   * in package order; `jobId` and `jobType` are absent for a ready index whose
   * fields did not change.
   *
   * Not atomic: when an index fails, the ones before it stay created or updated
   * and the call throws that index's error — `400` for an unreadable package or
   * an invalid field, `409` for a running job or a stale `metadata.version`.
   */
  async importIndexes(pkg: SearchIndexExport, auth: AuthContext = SERVICE): Promise<SearchIndexImportResult[]> {
    return this.ctx.http.request<SearchIndexImportResult[]>({
      method: "POST",
      path: `${this.base()}/search/indexes/import`,
      auth,
      body: pkg,
    });
  }

  /** List index jobs of the tenant. */
  async listJobs(opts: SearchListOptions = {}, auth: AuthContext = SERVICE): Promise<PaginatedItems<SearchIndexJob>> {
    const { query, page } = pageQuery(opts);
    return requestPage<SearchIndexJob>(
      this.ctx.http,
      { method: "GET", path: `${this.base()}/jobs`, auth, query },
      page,
    );
  }

  /** Fetch one index job. */
  async getJob(id: string, opts: { fields?: string } = {}, auth: AuthContext = SERVICE): Promise<SearchIndexJob> {
    return this.ctx.http.request<SearchIndexJob>({
      method: "GET",
      path: `${this.base()}/jobs/${encodeURIComponent(id)}`,
      auth,
      ...(opts.fields === undefined ? {} : { query: { fields: opts.fields } }),
    });
  }
}
