import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type { Configuration, ConfigurationDraft, ListConfigOptions } from "./configuration-types";

export type { Configuration, ConfigurationDraft, ListConfigOptions } from "./configuration-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Tenant-wide configuration (`/configuration/{tenant}/configurations`).
 * Requires the backend-only `configuration.configuration_view` /
 * `configuration.configuration_manage` scopes — default auth: service.
 * Server-side use only; the service token must never reach a browser.
 */
export class TenantConfigService {
  static readonly channel = "configuration" as const;
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/configuration/${this.ctx.tenant}/configurations`;
  }

  /** List tenant configurations, optionally filtered by `keys`. */
  async list(opts: ListConfigOptions = {}, auth: AuthContext = SERVICE): Promise<Configuration[]> {
    const query = opts.keys && opts.keys.length > 0 ? { keys: opts.keys.join(",") } : undefined;
    return this.ctx.http.request<Configuration[]>({
      method: "GET",
      path: this.base(),
      auth,
      ...(query ? { query } : {}),
    });
  }

  /** Retrieve one tenant configuration by key. */
  async get<T = unknown>(key: string, auth: AuthContext = SERVICE): Promise<Configuration<T>> {
    return this.ctx.http.request<Configuration<T>>({
      method: "GET",
      path: `${this.base()}/${encodeURIComponent(key)}`,
      auth,
    });
  }

  /** Create one or more tenant configurations (array in, array out). */
  async create(drafts: ConfigurationDraft[], auth: AuthContext = SERVICE): Promise<Configuration[]> {
    return this.ctx.http.request<Configuration[]>({
      method: "POST",
      path: this.base(),
      auth,
      body: drafts,
    });
  }

  /** Update one tenant configuration by key. */
  async update<T = unknown>(
    key: string,
    draft: ConfigurationDraft<T>,
    auth: AuthContext = SERVICE,
  ): Promise<Configuration<T>> {
    return this.ctx.http.request<Configuration<T>>({
      method: "PUT",
      path: `${this.base()}/${encodeURIComponent(key)}`,
      auth,
      body: draft,
    });
  }

  /** Delete one tenant configuration by key. */
  async delete(key: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/${encodeURIComponent(key)}`,
      auth,
    });
  }
}
