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
  DiagnosticPage,
  DiagnosticRecord,
  ErrorRecord,
  GetImporttoolListRunDiagnosticsData,
  GetImporttoolSearchDataRecordsData,
  GetImporttoolStreamOrderResponse,
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
  TraitDiagnosticsKind,
} from "../generated/import-service";

/** An import configuration, grouping one or more streams. */
export type ImportConfig = GenImportConfig;
/** A stream: extracts from a source, maps fields, upserts into an Emporix target type. */
export type ImportStream = GenImportStream;
/** A cron schedule for a configuration. `cron` is a six-field Spring expression. */
export type ImportSchedule = Schedule;
/**
 * An import run with its reconciled counters.
 *
 * Two counters describe the **source feed** rather than the import: a run can
 * report `SUCCEEDED` while `duplicateKeys` (source rows repeating a key already
 * imported in the run — only the last survives) and `unresolvedParents` (child
 * records whose parent was not found, distinct from `skipped`, which means
 * already up to date) hide real data loss from the pass/fail counters.
 *
 * `dryRunSample` carries the previewed records on a dry run and is absent on a
 * normal one. `origin` echoes what asked for the run, and is absent on runs
 * recorded before that field existed.
 *
 * `mappingVersions` lists the published mapping version each stream runs with,
 * fixed when the run starts — version `0` means the stream has no published
 * mappings. It is absent on a dry run of the draft mappings and on runs recorded
 * before 2026-09-28. `dryRunPublished` says which mappings a dry run used.
 */
export type ImportRun = GenImportRun;
/**
 * Per-stream progress within a run. A stream `ABORTED` was not run because of
 * its configuration — typically mappings that were never published — and its
 * `message` says why.
 */
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
 * A configuration's computed run order: `order` lists stream **names** in the
 * order they run, `prereqs` maps each name to the streams it waits for.
 */
export type ImportStreamOrder = GetImporttoolStreamOrderResponse;

/**
 * The rows behind a run's feed-quality counters. **A capped sample, not the
 * whole set**: `recorded` is how many rows were stored and `sampleTruncated`
 * says whether a stream hit the cap. The run's own `duplicateKeys` /
 * `unresolvedParents` are the true totals — `rows.length` is not.
 */
export type ImportRunDiagnostics = DiagnosticPage;
/** One diagnostic row: the record's natural key, its parent-linking field and value, and how many lines wait on it. */
export type ImportDiagnosticRecord = DiagnosticRecord;
/** Which counter a diagnostic row belongs to: `REPEATED_KEY` (`duplicateKeys`) or `UNRESOLVED_PARENT` (`unresolvedParents`). */
export type ImportDiagnosticKind = TraitDiagnosticsKind;
/** Filters for `listRunDiagnostics` / `downloadRunDiagnosticsCsv`: `{ streamId?, kind?, limit? }`. */
export type ImportRunDiagnosticsQuery = NonNullable<GetImporttoolListRunDiagnosticsData["query"]>;

/**
 * Body for `triggerRun`: `{ mode?, dryRun?, force?, sampleSize?, origin?, streamIds?, mappings? }`.
 *
 * - `mode` defaults to `DELTA` server-side.
 * - `streamIds` runs only those streams — **ids, not names** (`getStreamOrder`
 *   reports names). Omitted, every stream runs. Rejected: an empty list, a list
 *   with no stream of this configuration, and a child stream that cannot produce
 *   data without its parent. Listed streams still run in the computed order.
 * - `force` rewrites every extracted record, bypassing the skip-if-unchanged
 *   idempotency.
 * - `sampleSize` is **dry-run only**: how many mapped records to sample per
 *   stream into the run's `dryRunSample`. Clamped to 1–100, defaults to 25.
 * - `mappings` is **dry-run only** too: `"published"` (the default) checks what
 *   a real run would execute, `"draft"` checks saved mapping changes before they
 *   are published. A real run always uses the published mappings, so the field
 *   has no effect there.
 * - `origin` is free text naming *what* asked for the run (`"Dashboard"`, an
 *   integration scenario, your own scheduler), as opposed to `trigger`, which
 *   only ever records `MANUAL` or `SCHEDULED`. Omitted or blank, the service
 *   stores the `trigger` value instead. **Over 40 characters or containing
 *   control characters is rejected, not shortened** — a truncated label in an
 *   audit trail is worse than a refused request.
 */
export type ImportRunInput = NonNullable<PostImporttoolTriggerRunData["body"]>;
/**
 * Lifecycle status of an {@link ImportRun}. `ABORTED` means the service refused
 * to start the run because of its configuration — mappings that were never
 * published, or a changed target schema — and nothing was read or written.
 */
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
