import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  AgenticPatchOp,
  ListQuery,
  GetOptions,
  MutateOptions,
  SearchQuery,
  Created,
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
