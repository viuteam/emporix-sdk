import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type { IndexConfig, IndexConfigCreated, IndexPublicConfig, ReindexInput } from "./indexing-types";

export type { IndexConfig, IndexConfigCreated, IndexPublicConfig, ReindexInput } from "./indexing-types";

const SERVICE: AuthContext = { kind: "service" };

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

  /** Trigger a reindex. */
  async reindex(input: ReindexInput, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({ method: "POST", path: `${this.base()}/reindex`, auth, body: input });
  }
}
