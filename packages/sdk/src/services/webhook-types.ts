import type {
  WebhookSubscription as GenWebhookSubscription,
  WebhookSubscriptionUpdateItem as GenWebhookSubscriptionUpdateItem,
  UpdateSubscriptionResponse as GenUpdateSubscriptionResponse,
  AbstractWebhookConfig,
  ConfigCode,
  ConfigurationGet,
  WebhookConfigCreation,
  WebhookConfigPartialUpdate,
  WebhookStatistics as GenWebhookStatistics,
  DashboardAccess as GenDashboardAccess,
} from "../generated/webhook";

/** A webhook event subscription (read model): the event metadata + on/off state. */
export type WebhookSubscription = GenWebhookSubscription;

/** One item of the batch `PATCH /event-subscriptions` body. `eventType` is required. */
export type WebhookSubscriptionUpdateItem = GenWebhookSubscriptionUpdateItem;

/**
 * One element of the **207** result returned by `updateEventSubscriptions`.
 * `code`/`status` reflect per-item success/failure — the batch can partially fail.
 */
export type WebhookSubscriptionUpdateResultItem = GenUpdateSubscriptionResponse;

/**
 * A webhook delivery configuration as returned by `getConfig`/`listConfigs`:
 * `active`/`provider` plus the server-assigned `code` and read-only
 * `configuration` (the `secretKey` is never returned — only `secretKeyExists`).
 */
export type WebhookConfig = AbstractWebhookConfig & {
  code?: ConfigCode;
  configuration?: ConfigurationGet;
};

/** Body for `createConfig` / `replaceConfig` (carries `code`; `secretKey` is write-only). */
export type WebhookConfigDraft = WebhookConfigCreation;

/**
 * One operation of the `patchConfig` body. The PATCH endpoint takes an **array**
 * of these `{ op, path, value }` operations (UPSERT / REMOVE).
 */
export type WebhookConfigPatch = WebhookConfigPartialUpdate;

/** Response of `createConfig`. */
export interface WebhookConfigCreated {
  code: string;
}

/** Webhook delivery statistics (SVIX_SHARED-oriented). */
export type WebhookStatistics = GenWebhookStatistics;

/** Svix dashboard access (URL / token) returned by `getDashboardAccess`. */
export type WebhookDashboardAccess = GenDashboardAccess;

/** Query for `getStatistics`. Both bounds are `YYYY-MM`; omitted when absent. */
export interface WebhookStatisticsQuery {
  fromYearMonth?: string;
  toYearMonth?: string;
}

/** Options for `deleteConfig`. */
export interface DeleteConfigOptions {
  /** Required to delete the currently-active config. Serialized as `?force=true`. */
  force?: boolean;
}
