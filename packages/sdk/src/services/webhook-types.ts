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
  DeliveryStatus,
  DeliveryTargetType,
  FailedMessage,
  FailedMessageSelection,
  Job,
  JobId,
  GetWebhookListConfigsData,
  GetWebhookListFailedMessagesData,
  GetWebhookListJobsData,
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

/**
 * Options for `listConfigs` / `getConfig`. `expand: "deliveryStatus"` adds a
 * `deliveryStatus` to the config and to every `eventsConfiguration` entry.
 */
export type WebhookConfigReadOptions = NonNullable<GetWebhookListConfigsData["query"]>;

/** Health of one delivery target, returned with `expand: "deliveryStatus"`. */
export type WebhookDeliveryStatus = DeliveryStatus;

/** Kind of delivery target a failed message belongs to. */
export type WebhookDeliveryTargetType = DeliveryTargetType;

/**
 * An event the service stored instead of delivering it. `payload` is present
 * only on `getFailedMessage`; the list never returns it.
 */
export type WebhookFailedMessage = FailedMessage;

/**
 * Selection for `restartFailedMessages` / `deleteFailedMessages`. Every field is
 * optional and they combine with AND — an empty object selects **every** stored
 * message.
 */
export type WebhookFailedMessageSelection = FailedMessageSelection;

/**
 * Query for `listFailedMessages`: the spec's filters, `q`, `sort`, `fields`,
 * paging, and the `next` / `prev` cursors, plus the SDK-side `totalCount` flag.
 */
export type ListFailedMessagesQuery = NonNullable<GetWebhookListFailedMessagesData["query"]> & {
  /** Ask for `X-Total-Count`; sent as a request header. Ignored in cursor mode. */
  totalCount?: boolean;
};

/** A background job of the webhook service, such as a restart of failed messages. */
export type WebhookJob = Job;

/** Response of `restartFailedMessages`: the id of the job it started. */
export type WebhookJobStarted = JobId;

/** Query for `listJobs`, plus the SDK-side `totalCount` flag. */
export type ListWebhookJobsQuery = NonNullable<GetWebhookListJobsData["query"]> & {
  /** Ask for `X-Total-Count`; sent as a request header. */
  totalCount?: boolean;
};
