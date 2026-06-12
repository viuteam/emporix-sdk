import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type { Return, ReturnList, ReturnInput, ReturnUpdate, ReturnPatch, ReturnCreated } from "./returns-types";

export type { Return, ReturnList, ReturnInput, ReturnUpdate, ReturnPatch, ReturnCreated } from "./returns-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Emporix Returns Service (`/return/{tenant}/returns`): CRUD over returns
 * (RMA). Defaults to the service token; for customer self-service (own returns)
 * pass `auth.customer(token)` (the React hooks do this).
 */
export class ReturnsService {
  static readonly channel = "returns" as const;
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/return/${this.ctx.tenant}/returns`;
  }

  /** List returns (paged; supports `pageSize`/`pageNumber`/`sort`/`q`). */
  async listReturns(
    query: Record<string, string | number> = {},
    auth: AuthContext = SERVICE,
  ): Promise<ReturnList> {
    return this.ctx.http.request<ReturnList>({
      method: "GET",
      path: this.base(),
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Retrieve one return by id. */
  async getReturn(returnId: string, auth: AuthContext = SERVICE): Promise<Return> {
    return this.ctx.http.request<Return>({
      method: "GET",
      path: `${this.base()}/${encodeURIComponent(returnId)}`,
      auth,
    });
  }

  /** Create a return. Returns the created `{ id }`. */
  async createReturn(input: ReturnInput, auth: AuthContext = SERVICE): Promise<ReturnCreated> {
    return this.ctx.http.request<ReturnCreated>({
      method: "POST",
      path: this.base(),
      auth,
      body: input,
    });
  }

  /** Replace a return by id (`PUT`). */
  async updateReturn(returnId: string, input: ReturnUpdate, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `${this.base()}/${encodeURIComponent(returnId)}`,
      auth,
      body: input,
    });
  }

  /** Partially update a return by id (`PATCH`, JSON-Patch op-array). */
  async patchReturn(returnId: string, ops: ReturnPatch, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PATCH",
      path: `${this.base()}/${encodeURIComponent(returnId)}`,
      auth,
      body: ops,
    });
  }

  /** Delete a return by id. */
  async deleteReturn(returnId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/${encodeURIComponent(returnId)}`,
      auth,
    });
  }
}
