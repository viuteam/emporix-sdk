import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  AgenticPatchOp,
  ListQuery,
  GetOptions,
  MutateOptions,
  SearchQuery,
  Created,
  Job,
  AgentTemplate,
  AgentFromTemplate,
  AgentRequestLog,
  AgentSessionLog,
} from "./ai-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * A symmetric CRUD resource over an agentic sub-collection (`tools`,
 * `mcp-servers`, `tokens`, `oauths`). All six operations share the upstream
 * shape; only the base path and the Read/Write types differ. Server-side only
 * — every call defaults to the SERVICE (backend) token.
 */
export class AgenticCrudResource<Read, Write> {
  constructor(
    private readonly ctx: ClientContext,
    private readonly path: string,
  ) {}

  private item(id: string): string {
    return `${this.path}/${encodeURIComponent(id)}`;
  }

  /** List the collection (`GET {path}`). Optional `q`/paging/sort/fields/expand. */
  list(query: ListQuery = {}, auth: AuthContext = SERVICE): Promise<Read[]> {
    return this.ctx.http.request<Read[]>({ method: "GET", path: this.path, auth, query: { ...query } });
  }

  /** Structured search (`POST {path}/search`). Body is `{ q? }`. */
  search(query: SearchQuery, auth: AuthContext = SERVICE): Promise<Read[]> {
    return this.ctx.http.request<Read[]>({ method: "POST", path: `${this.path}/search`, auth, body: query });
  }

  /** Retrieve one entry by id (`GET {path}/{id}`). */
  get(id: string, opts: GetOptions = {}, auth: AuthContext = SERVICE): Promise<Read> {
    return this.ctx.http.request<Read>({ method: "GET", path: this.item(id), auth, query: { ...opts } });
  }

  /**
   * Create-or-replace by id (`PUT {path}/{id}`). Resolves to `{ id }` on create
   * (HTTP 201) and `undefined` on update (HTTP 204). `{ force: true }`
   * cascade-disables dependents.
   */
  upsert(
    id: string,
    body: Write,
    opts: MutateOptions = {},
    auth: AuthContext = SERVICE,
  ): Promise<Created | undefined> {
    return this.ctx.http.request<Created | undefined>({
      method: "PUT",
      path: this.item(id),
      auth,
      body,
      ...(opts.force ? { query: { force: "true" } } : {}),
    });
  }

  /**
   * Partial update with an op array (`PATCH {path}/{id}`, 204). `ops` use the
   * upstream UPPERCASE enum (`ADD | REMOVE | REPLACE`), sent verbatim.
   */
  async patch(id: string, ops: AgenticPatchOp[], auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({ method: "PATCH", path: this.item(id), auth, body: ops });
  }

  /** Delete by id (`DELETE {path}/{id}`). `{ force: true }` removes even if referenced. */
  async delete(id: string, opts: MutateOptions = {}, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: this.item(id),
      auth,
      ...(opts.force ? { query: { force: "true" } } : {}),
    });
  }
}

/**
 * AI async jobs (`/ai-service/{tenant}/jobs`). NOTE: not under `/agentic`.
 * `chatAsync` returns a `jobId`; poll/list/delete it here.
 */
export class JobsResource {
  constructor(
    private readonly ctx: ClientContext,
    private readonly base: string,
  ) {}

  /** List jobs (`GET /jobs`). */
  list(query: ListQuery = {}, auth: AuthContext = SERVICE): Promise<Job[]> {
    return this.ctx.http.request<Job[]>({ method: "GET", path: `${this.base}/jobs`, auth, query: { ...query } });
  }
  /** Structured job search (`POST /jobs/search`). */
  search(query: SearchQuery, auth: AuthContext = SERVICE): Promise<Job[]> {
    return this.ctx.http.request<Job[]>({ method: "POST", path: `${this.base}/jobs/search`, auth, body: query });
  }
  /** Retrieve one job (`GET /jobs/{jobId}`). */
  get(jobId: string, auth: AuthContext = SERVICE): Promise<Job> {
    return this.ctx.http.request<Job>({ method: "GET", path: `${this.base}/jobs/${encodeURIComponent(jobId)}`, auth });
  }
  /** Delete one job (`DELETE /jobs/{jobId}`). */
  async delete(jobId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({ method: "DELETE", path: `${this.base}/jobs/${encodeURIComponent(jobId)}`, auth });
  }
}

/** Agent templates (`/agentic/templates`). `list · search · clone`. */
export class TemplatesResource {
  constructor(
    private readonly ctx: ClientContext,
    private readonly path: string, // `${base}/agentic/templates`
  ) {}

  /** List available templates (`GET /agentic/templates`). */
  list(query: ListQuery = {}, auth: AuthContext = SERVICE): Promise<AgentTemplate[]> {
    return this.ctx.http.request<AgentTemplate[]>({ method: "GET", path: this.path, auth, query: { ...query } });
  }
  /** Structured template search (`POST /agentic/templates/search`). */
  search(query: SearchQuery, auth: AuthContext = SERVICE): Promise<AgentTemplate[]> {
    return this.ctx.http.request<AgentTemplate[]>({ method: "POST", path: `${this.path}/search`, auth, body: query });
  }
  /**
   * Instantiate a new agent from a template
   * (`POST /agentic/templates/{templateId}/agents`, HTTP 201). Returns the
   * created agent's id.
   */
  clone(templateId: string, body: AgentFromTemplate, auth: AuthContext = SERVICE): Promise<Created> {
    return this.ctx.http.request<Created>({
      method: "POST",
      path: `${this.path}/${encodeURIComponent(templateId)}/agents`,
      auth,
      body,
    });
  }
}

/** Agent logs (`/agentic/logs`): request logs and session logs. */
export class LogsResource {
  constructor(
    private readonly ctx: ClientContext,
    private readonly path: string, // `${base}/agentic/logs`
  ) {}

  /** List request logs (`GET /agentic/logs/requests`). */
  listRequests(query: ListQuery = {}, auth: AuthContext = SERVICE): Promise<AgentRequestLog[]> {
    return this.ctx.http.request<AgentRequestLog[]>({ method: "GET", path: `${this.path}/requests`, auth, query: { ...query } });
  }
  /** Retrieve one request log (`GET /agentic/logs/requests/{requestId}`). */
  getRequest(requestId: string, auth: AuthContext = SERVICE): Promise<AgentRequestLog> {
    return this.ctx.http.request<AgentRequestLog>({ method: "GET", path: `${this.path}/requests/${encodeURIComponent(requestId)}`, auth });
  }
  /** Structured request-log search (`POST /agentic/logs/requests/search`). */
  searchRequests(query: SearchQuery, auth: AuthContext = SERVICE): Promise<AgentRequestLog[]> {
    return this.ctx.http.request<AgentRequestLog[]>({ method: "POST", path: `${this.path}/requests/search`, auth, body: query });
  }
  /** List session logs (`GET /agentic/logs/sessions`). */
  listSessions(query: ListQuery = {}, auth: AuthContext = SERVICE): Promise<AgentSessionLog[]> {
    return this.ctx.http.request<AgentSessionLog[]>({ method: "GET", path: `${this.path}/sessions`, auth, query: { ...query } });
  }
  /** Retrieve one session log (`GET /agentic/logs/sessions/{sessionId}`). */
  getSession(sessionId: string, auth: AuthContext = SERVICE): Promise<AgentSessionLog> {
    return this.ctx.http.request<AgentSessionLog>({ method: "GET", path: `${this.path}/sessions/${encodeURIComponent(sessionId)}`, auth });
  }
  /** Structured session-log search (`POST /agentic/logs/sessions/search`). */
  searchSessions(query: SearchQuery, auth: AuthContext = SERVICE): Promise<AgentSessionLog[]> {
    return this.ctx.http.request<AgentSessionLog[]>({ method: "POST", path: `${this.path}/sessions/search`, auth, body: query });
  }
}
