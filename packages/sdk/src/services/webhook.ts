import type { ClientContext, PaginatedItems } from "../core/context";
import type { AuthContext } from "../core/auth";
import { requestPage } from "../core/paged";
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
  WebhookConfigReadOptions,
  WebhookFailedMessage,
  WebhookFailedMessageSelection,
  ListFailedMessagesQuery,
  WebhookJob,
  WebhookJobStarted,
  ListWebhookJobsQuery,
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
  WebhookConfigReadOptions,
  WebhookDeliveryStatus,
  WebhookDeliveryTargetType,
  WebhookFailedMessage,
  WebhookFailedMessageSelection,
  ListFailedMessagesQuery,
  WebhookJob,
  WebhookJobStarted,
  ListWebhookJobsQuery,
} from "./webhook-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * `listConfigs` and `getConfig` took only `auth` before they took options.
 * Tells that original call apart from `(opts, auth)`, so an auth context is
 * never read as options and the call never falls back to the default token.
 */
function isAuthContext(value: WebhookConfigReadOptions | AuthContext): value is AuthContext {
  return "kind" in value;
}

function readQuery(opts: WebhookConfigReadOptions): { query?: Record<string, string> } {
  return opts.expand === undefined ? {} : { query: { expand: opts.expand } };
}

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

  /**
   * List delivery configurations. `{ expand: "deliveryStatus" }` adds each
   * target's delivery health (`ACTIVE` / `FAILING`, consecutive failures, last
   * error). The original `listConfigs(auth)` still works.
   */
  listConfigs(auth?: AuthContext): Promise<WebhookConfig[]>;
  listConfigs(opts: WebhookConfigReadOptions, auth?: AuthContext): Promise<WebhookConfig[]>;
  async listConfigs(
    optsOrAuth: WebhookConfigReadOptions | AuthContext = {},
    auth: AuthContext = SERVICE,
  ): Promise<WebhookConfig[]> {
    const [opts, ctx] = isAuthContext(optsOrAuth) ? [{}, optsOrAuth] : [optsOrAuth, auth];
    return this.ctx.http.request<WebhookConfig[]>({
      method: "GET",
      path: `${this.base()}/config`,
      auth: ctx,
      ...readQuery(opts),
    });
  }

  /**
   * Retrieve one delivery configuration by code. Takes the same
   * `{ expand: "deliveryStatus" }` as {@link listConfigs}; the original
   * `getConfig(code, auth)` still works.
   */
  getConfig(code: string, auth?: AuthContext): Promise<WebhookConfig>;
  getConfig(code: string, opts: WebhookConfigReadOptions, auth?: AuthContext): Promise<WebhookConfig>;
  async getConfig(
    code: string,
    optsOrAuth: WebhookConfigReadOptions | AuthContext = {},
    auth: AuthContext = SERVICE,
  ): Promise<WebhookConfig> {
    const [opts, ctx] = isAuthContext(optsOrAuth) ? [{}, optsOrAuth] : [optsOrAuth, auth];
    return this.ctx.http.request<WebhookConfig>({
      method: "GET",
      path: `${this.base()}/config/${encodeURIComponent(code)}`,
      auth: ctx,
      ...readQuery(opts),
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

  // --- Failed messages ---------------------------------------------------------

  /**
   * List the events the service stored instead of delivering them, newest
   * failure first. An event is stored once its target has failed 100 times in a
   * row (`webhookFailureThreshold` in the Configuration Service, 10–1000), and
   * is kept for 14 days on production, 1 day on preprod. The list never returns
   * `payload`; {@link getFailedMessage} does.
   *
   * Pages by `pageNumber` / `pageSize` (default 60, max 2000) or by cursor: pass
   * a page's `nextCursor` back as `next` (or `prevCursor` as `prev`), and keep
   * the same `sort`. In cursor mode `pageNumber` is not sent and no total is
   * returned. `next` and `prev` together answer 400.
   */
  async listFailedMessages(
    query: ListFailedMessagesQuery = {},
    auth: AuthContext = SERVICE,
  ): Promise<PaginatedItems<WebhookFailedMessage>> {
    const pageNumber = query.pageNumber ?? 1;
    const pageSize = query.pageSize ?? 60;
    // `totalCount` is an SDK-side flag that requestPage turns into a header.
    const { totalCount, ...rest } = query;
    // A cursor replaces the page number; the spec does not say the two combine.
    // `undefined` keeps a caller's pageNumber off the wire (HttpClient skips it).
    const cursor = rest.next !== undefined || rest.prev !== undefined;
    return requestPage<WebhookFailedMessage>(
      this.ctx.http,
      {
        method: "GET",
        path: `${this.base()}/failed-messages`,
        auth,
        query: { ...rest, pageNumber: cursor ? undefined : pageNumber, pageSize },
      },
      { pageNumber, pageSize, ...(totalCount === undefined ? {} : { totalCount }) },
    );
  }

  /** Retrieve one failed message, including its `payload`. Unknown id: `EmporixNotFoundError`. */
  async getFailedMessage(id: string, auth: AuthContext = SERVICE): Promise<WebhookFailedMessage> {
    return this.ctx.http.request<WebhookFailedMessage>({
      method: "GET",
      path: `${this.base()}/failed-messages/${encodeURIComponent(id)}`,
      auth,
    });
  }

  /** Delete one failed message (204). The event is not delivered. */
  async deleteFailedMessage(id: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/failed-messages/${encodeURIComponent(id)}`,
      auth,
    });
  }

  /**
   * Queue one failed message for delivery again and remove it from the stored
   * messages (202). Delivery happens after the response, with the target's
   * current configuration; a new failure counts towards its limit again.
   *
   * `EmporixConflictError` (409) means it cannot be delivered now: the config
   * or entry is gone, inactive (switched off after failures — activate it
   * first), on another provider, or no longer delivers this event type.
   */
  async resendFailedMessage(id: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "POST",
      path: `${this.base()}/failed-messages/${encodeURIComponent(id)}/resend`,
      auth,
    });
  }

  /**
   * Start a job that resends every failed message matching `selection` (202).
   * The criteria combine with AND; **`{}` restarts every stored message** —
   * which is why there is no default. Only messages stored before the job
   * started are covered; ones that cannot be resent are skipped and stay stored.
   * Follow the job with {@link getJob}. One restart job per tenant at a time:
   * a second one answers `EmporixConflictError` (409).
   */
  async restartFailedMessages(
    selection: WebhookFailedMessageSelection,
    auth: AuthContext = SERVICE,
  ): Promise<WebhookJobStarted> {
    return this.ctx.http.request<WebhookJobStarted>({
      method: "POST",
      path: `${this.base()}/failed-messages/restart`,
      auth,
      body: selection,
    });
  }

  /**
   * Delete every failed message matching `selection` (204); the events are not
   * delivered. The criteria combine with AND; **`{}` deletes every stored
   * message** — which is why there is no default.
   */
  async deleteFailedMessages(
    selection: WebhookFailedMessageSelection,
    auth: AuthContext = SERVICE,
  ): Promise<void> {
    await this.ctx.http.request<void>({
      method: "POST",
      path: `${this.base()}/failed-messages/delete`,
      auth,
      body: selection,
    });
  }

  // --- Jobs ------------------------------------------------------------------

  /** List the tenant's jobs, newest first (`pageSize` default 60). */
  async listJobs(
    query: ListWebhookJobsQuery = {},
    auth: AuthContext = SERVICE,
  ): Promise<PaginatedItems<WebhookJob>> {
    const pageNumber = query.pageNumber ?? 1;
    const pageSize = query.pageSize ?? 60;
    const { totalCount, ...rest } = query;
    return requestPage<WebhookJob>(
      this.ctx.http,
      {
        method: "GET",
        path: `${this.base()}/jobs`,
        auth,
        query: { ...rest, pageNumber, pageSize },
      },
      { pageNumber, pageSize, ...(totalCount === undefined ? {} : { totalCount }) },
    );
  }

  /** Retrieve one job and its progress (`status`, `republished`, `skipped`). */
  async getJob(id: string, auth: AuthContext = SERVICE): Promise<WebhookJob> {
    return this.ctx.http.request<WebhookJob>({
      method: "GET",
      path: `${this.base()}/jobs/${encodeURIComponent(id)}`,
      auth,
    });
  }
}
