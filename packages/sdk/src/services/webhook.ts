import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  WebhookSubscription,
  WebhookSubscriptionUpdateItem,
  WebhookSubscriptionUpdateResultItem,
  WebhookConfig,
  WebhookConfigDraft,
  WebhookConfigPatch,
  WebhookConfigCreated,
  WebhookStatistics,
  WebhookDashboardAccess,
  WebhookStatisticsQuery,
  DeleteConfigOptions,
} from "./webhook-types";

export type {
  WebhookSubscription,
  WebhookSubscriptionUpdateItem,
  WebhookSubscriptionUpdateResultItem,
  WebhookConfig,
  WebhookConfigDraft,
  WebhookConfigPatch,
  WebhookConfigCreated,
  WebhookStatistics,
  WebhookDashboardAccess,
  WebhookStatisticsQuery,
  DeleteConfigOptions,
} from "./webhook-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Webhook administration (`/webhook/{tenant}/…`): the event-subscription
 * catalog and batch toggle, delivery-config CRUD, statistics, and Svix
 * dashboard access. Requires the backend-only `webhook.subscription_read` /
 * `webhook.subscription_manage` scopes — default auth: service. Server-side
 * use only; the service token must never reach a browser.
 */
export class WebhookService {
  static readonly channel = "webhook" as const;
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/webhook/${this.ctx.tenant}`;
  }

  /** List the event-subscription catalog with each event's on/off state. */
  async listEventSubscriptions(auth: AuthContext = SERVICE): Promise<WebhookSubscription[]> {
    return this.ctx.http.request<WebhookSubscription[]>({
      method: "GET",
      path: `${this.base()}/event-subscriptions`,
      auth,
    });
  }

  /**
   * Batch subscribe/unsubscribe events. Returns the **207** per-item result
   * array verbatim — the batch can partially fail, so inspect each element's
   * `code`/`status` (e.g. `results.filter(r => (r.code ?? 0) >= 400)`). Does
   * NOT throw on a 207 with failed items; only a non-2xx HTTP status throws.
   */
  async updateEventSubscriptions(
    items: WebhookSubscriptionUpdateItem[],
    auth: AuthContext = SERVICE,
  ): Promise<WebhookSubscriptionUpdateResultItem[]> {
    return this.ctx.http.request<WebhookSubscriptionUpdateResultItem[]>({
      method: "PATCH",
      path: `${this.base()}/event-subscriptions`,
      auth,
      body: items,
    });
  }

  /** List delivery configurations. */
  async listConfigs(auth: AuthContext = SERVICE): Promise<WebhookConfig[]> {
    return this.ctx.http.request<WebhookConfig[]>({
      method: "GET",
      path: `${this.base()}/config`,
      auth,
    });
  }

  /** Retrieve one delivery configuration by code. */
  async getConfig(code: string, auth: AuthContext = SERVICE): Promise<WebhookConfig> {
    return this.ctx.http.request<WebhookConfig>({
      method: "GET",
      path: `${this.base()}/config/${encodeURIComponent(code)}`,
      auth,
    });
  }

  /** Create a delivery configuration. Returns the server-assigned `{ code }`. */
  async createConfig(
    draft: WebhookConfigDraft,
    auth: AuthContext = SERVICE,
  ): Promise<WebhookConfigCreated> {
    return this.ctx.http.request<WebhookConfigCreated>({
      method: "POST",
      path: `${this.base()}/config`,
      auth,
      body: draft,
    });
  }

  /** Replace a delivery configuration by code (204). */
  async replaceConfig(
    code: string,
    draft: WebhookConfigDraft,
    auth: AuthContext = SERVICE,
  ): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `${this.base()}/config/${encodeURIComponent(code)}`,
      auth,
      body: draft,
    });
  }

  /**
   * Partially update a delivery configuration by code (204). The body is an
   * **array** of `{ op, path, value }` operations (UPSERT / REMOVE).
   */
  async patchConfig(
    code: string,
    patches: WebhookConfigPatch[],
    auth: AuthContext = SERVICE,
  ): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PATCH",
      path: `${this.base()}/config/${encodeURIComponent(code)}`,
      auth,
      body: patches,
    });
  }

  /**
   * Delete a delivery configuration by code. Pass `{ force: true }` to delete
   * the currently-active config (the server otherwise rejects it).
   */
  async deleteConfig(
    code: string,
    opts: DeleteConfigOptions = {},
    auth: AuthContext = SERVICE,
  ): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/config/${encodeURIComponent(code)}`,
      auth,
      ...(opts.force === true ? { query: { force: "true" } } : {}),
    });
  }

  /** Read delivery statistics over an optional `YYYY-MM` range. */
  async getStatistics(
    query: WebhookStatisticsQuery = {},
    auth: AuthContext = SERVICE,
  ): Promise<WebhookStatistics> {
    const q: Record<string, string> = {};
    if (query.fromYearMonth) q.fromYearMonth = query.fromYearMonth;
    if (query.toYearMonth) q.toYearMonth = query.toYearMonth;
    return this.ctx.http.request<WebhookStatistics>({
      method: "GET",
      path: `${this.base()}/statistics`,
      auth,
      ...(Object.keys(q).length > 0 ? { query: q } : {}),
    });
  }

  /** Obtain Svix dashboard access (URL / token). */
  async getDashboardAccess(auth: AuthContext = SERVICE): Promise<WebhookDashboardAccess> {
    return this.ctx.http.request<WebhookDashboardAccess>({
      method: "GET",
      path: `${this.base()}/dashboard-access`,
      auth,
    });
  }
}
