import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type { ClientConfiguration, ConfigurationDraft, ListConfigOptions } from "./configuration-types";

export type { ClientConfiguration } from "./configuration-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Per-client configuration (`/configuration/{tenant}/clients/{client}/configurations`).
 * Requires the backend-only `configuration.configuration_view` /
 * `configuration.configuration_manage` scopes — default auth: service.
 * Server-side use only; the service token must never reach a browser.
 * The `client` arg is injected into each write body so callers don't repeat it.
 */
export class ClientConfigService {
  static readonly channel = "configuration" as const;
  constructor(private readonly ctx: ClientContext) {}

  private base(client: string): string {
    return `/configuration/${this.ctx.tenant}/clients/${encodeURIComponent(client)}/configurations`;
  }

  /** List a client's configurations, optionally filtered by `keys`. */
  async list(
    client: string,
    opts: ListConfigOptions = {},
    auth: AuthContext = SERVICE,
  ): Promise<ClientConfiguration[]> {
    const query = opts.keys && opts.keys.length > 0 ? { keys: opts.keys.join(",") } : undefined;
    return this.ctx.http.request<ClientConfiguration[]>({
      method: "GET",
      path: this.base(client),
      auth,
      ...(query ? { query } : {}),
    });
  }

  /** Retrieve one client configuration by key. */
  async get<T = unknown>(
    client: string,
    key: string,
    auth: AuthContext = SERVICE,
  ): Promise<ClientConfiguration<T>> {
    return this.ctx.http.request<ClientConfiguration<T>>({
      method: "GET",
      path: `${this.base(client)}/${encodeURIComponent(key)}`,
      auth,
    });
  }

  /** Create one or more client configurations. Injects `client` into each item. */
  async create(
    client: string,
    drafts: ConfigurationDraft[],
    auth: AuthContext = SERVICE,
  ): Promise<ClientConfiguration[]> {
    const body = drafts.map((d) => ({ ...d, client }));
    return this.ctx.http.request<ClientConfiguration[]>({
      method: "POST",
      path: this.base(client),
      auth,
      body,
    });
  }

  /** Update one client configuration by key. Injects `client` into the body. */
  async update<T = unknown>(
    client: string,
    key: string,
    draft: ConfigurationDraft<T>,
    auth: AuthContext = SERVICE,
  ): Promise<ClientConfiguration<T>> {
    return this.ctx.http.request<ClientConfiguration<T>>({
      method: "PUT",
      path: `${this.base(client)}/${encodeURIComponent(key)}`,
      auth,
      body: { ...draft, client },
    });
  }

  /** Delete one client configuration by key. */
  async delete(client: string, key: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base(client)}/${encodeURIComponent(key)}`,
      auth,
    });
  }
}
