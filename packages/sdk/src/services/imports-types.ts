/**
 * Public types for the Import Service — stable names aliased over the
 * generated `import-service` types.
 *
 * Upstream names several schemas generically (`Schedule`, `RunDetail`,
 * `CancelResult`, `ErrorRecord`). Those would be poor citizens of the SDK root,
 * so everything is re-exported under an `Import…` name.
 */
import type { PaginatedItems } from "../core/context";
import type {
  CancelResult,
  ErrorRecord,
  GetImporttoolSearchDataRecordsData,
  ImportConfig as GenImportConfig,
  ImportRun as GenImportRun,
  ImportRunStream as GenImportRunStream,
  ImportStream as GenImportStream,
  ImportedRecord as GenImportedRecord,
  GetImporttoolStatsData,
  HealthSettings,
  ImportLicense as GenImportLicense,
  ImportStats as GenImportStats,
  JobGroup as GenJobGroup,
  PostImporttoolTriggerRunData,
  RunDetail,
  Schedule,
} from "../generated/import-service";

/** An import configuration, grouping one or more streams. */
export type ImportConfig = GenImportConfig;
/** A stream: extracts from a source, maps fields, upserts into an Emporix target type. */
export type ImportStream = GenImportStream;
/** A cron schedule for a configuration. `cron` is a six-field Spring expression. */
export type ImportSchedule = Schedule;
/** An import run with its reconciled counters. */
export type ImportRun = GenImportRun;
/** Per-stream progress within a run. */
export type ImportRunStream = GenImportRunStream;
/** A run together with its per-stream progress — what `getRun` resolves to. */
export type ImportRunDetail = RunDetail;
/** The outcome of a cancellation request. `accepted: false` means unknown or already finished. */
export type ImportCancelResult = CancelResult;
/** A single error recorded during a run. */
export type ImportErrorRecord = ErrorRecord;
/** A record that was imported, with its keys, stored fields and last outcome. */
export type ImportedRecord = GenImportedRecord;

/**
 * Body for `triggerRun`: `{ mode?, dryRun?, force? }`. `mode` defaults to
 * `DELTA` server-side; `force` rewrites every extracted record, bypassing the
 * skip-if-unchanged idempotency.
 */
export type ImportRunInput = NonNullable<PostImporttoolTriggerRunData["body"]>;
/** Lifecycle status of an {@link ImportRun}. */
export type ImportRunStatus = NonNullable<ImportRun["status"]>;
/** Run mode — `FULL` re-reads everything, `DELTA` only what changed. */
export type ImportRunMode = NonNullable<ImportRunInput["mode"]>;
/**
 * The `outcome` filter accepted by `searchRecords` / `searchStreamRecords`.
 *
 * Note the asymmetry: this filter is a closed enum, but `ImportedRecord.outcome`
 * is a free string upstream and its example value (`UPDATED`) is not in this
 * enum. Do not assume a record's `outcome` is always one of these five.
 */
export type ImportRecordOutcome = NonNullable<
  GetImporttoolSearchDataRecordsData["query"]["outcome"]
>;

/**
 * One frame of a run's progress stream, discriminated on `type` — which mirrors
 * the SSE `event:` name the service sends.
 *
 * `unknown` carries anything this SDK version does not model: a new event name,
 * an unparseable payload, a payload that is not a JSON object. It exists
 * because the service is in preview — an unrecognised frame must neither abort
 * a running import nor vanish silently.
 */
export type ImportRunEvent =
  /**
   * The initial state of the run and all its streams. `run` is spelled
   * `| undefined` because the spec makes it optional and the repo runs with
   * `exactOptionalPropertyTypes`.
   */
  | { type: "snapshot"; run?: ImportRun | undefined; streams: ImportRunStream[] }
  /** Progress for one stream, emitted per processed batch. */
  | { type: "stream"; stream: ImportRunStream }
  /** The final run state, emitted when the run finishes. */
  | { type: "run"; run: ImportRun }
  /** A frame this SDK version does not model. `data` is the raw payload. */
  | { type: "unknown"; event: string | undefined; data: string };

/**
 * A page from the import service. The usual {@link PaginatedItems} plus the
 * totals this API reports — the only paginated SDK surface where `hasNextPage`
 * is derived from `totalPages` instead of guessed from a full page.
 *
 * Assignable to `PaginatedItems<T>`, so `iterateAll` consumes it unchanged.
 */
export type ImportPage<T> = PaginatedItems<T> & {
  /** Total matching elements across all pages. */
  totalElements: number;
  /** Total number of pages. */
  totalPages: number;
};

/**
 * Aggregated import analytics: totals, a time series, an error breakdown and
 * per-stream health. Every section is optional — the `sections` filter decides
 * which ones the service computes.
 */
export type ImportStats = GenImportStats;

/** Query for {@link ImportsService.stats}. All filters optional. */
export type ImportStatsQuery = Omit<NonNullable<GetImporttoolStatsData["query"]>, never>;

/** One dashboard job group: a configuration and the runs grouped under it. */
export type ImportJobGroup = GenJobGroup;

/**
 * The tenant's health thresholds — the error rates above which a stream counts
 * as degraded or failing in {@link ImportStats}.
 */
export type ImportHealthThresholds = HealthSettings;

/** The tenant's import limits and current consumption. */
export type ImportLicense = GenImportLicense;
