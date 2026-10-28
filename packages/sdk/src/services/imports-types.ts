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
  FileQueue,
  GetImporttoolListRunDiagnosticsData,
  GetImporttoolSearchDataRecordsData,
  GetImporttoolStreamFileLimitsResponse,
  GetImporttoolStreamOrderResponse,
  ImportConfig as GenImportConfig,
  ImportFile as GenImportFile,
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
/**
 * A stream: extracts from a source, maps fields, upserts into an Emporix target type.
 *
 * `sourceDataset` says how the stream addresses its source — its properties
 * depend on the source type (`keyField`, `limit`, a delimited file's format,
 * …), so it stays an open record. For a file source, `fileMode` says what one
 * file represents: `SNAPSHOT` (the default) reads only the newest queued file
 * and does not delete records missing from it; `INCREMENTAL` reads every queued
 * file in load order, a later file's values winning.
 */
export type ImportStream = GenImportStream;
/** A cron schedule for a configuration. `cron` is a six-field Spring expression. */
export type ImportSchedule = Schedule;
/**
 * An import run with its reconciled counters.
 *
 * **The counters add up** (since 2026-10-28), on the run and on each stream:
 * `recordsRead` = `created` + `updated` + `skipped` + `unresolvedParents` +
 * `deleted` + `failed` + `collapsed` + `embedded`. A sum over only some of them
 * will not balance. `collapsed` counts source rows that repeated a key within
 * one batch and were merged before the write; `embedded` counts child records
 * an `EMBED` child handed to its parent, which wrote them inside its own
 * instance.
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
 * **Runs queue first** (since 2026-10-14). A requested run is `QUEUED` until a
 * worker is free, then `RUNNING`; `RESUMABLE` means it was interrupted and
 * resumes by itself — not a final status. `startedAt` is when the run was
 * requested, `executionStartedAt` when it began executing (`null` while queued).
 * A queued run carries `queueWaitingFor` (`WORKER`, `PREVIOUS_RUN` or
 * `TENANT_LIMIT`) and, while it waits for a worker, an approximate
 * `queuePosition`. `supersededRequests` counts later scheduled requests folded
 * into it, `lastRequestedAt` the latest of them.
 *
 * `mappingVersions` lists the published mapping version each stream runs with,
 * fixed when the run starts executing — version `0` means the stream has no
 * published mappings. It is absent while the run is `QUEUED` (so on the run
 * `triggerRun` returns), on a dry run of the draft mappings and on runs recorded
 * before 2026-09-28. `dryRunPublished` says which mappings a dry run used.
 */
export type ImportRun = GenImportRun;
/**
 * Per-stream progress within a run. A stream `ABORTED` was not run because of
 * its configuration — typically mappings that were never published — and its
 * `message` says why.
 *
 * For a file source, `filesRead` lists the files the stream read, in order,
 * and `fileNames` maps each of those opaque locators to its display name. A
 * retry re-reads exactly these bytes, even if a newer file arrived since.
 */
export type ImportRunStream = GenImportRunStream;
/** A run together with its per-stream progress — what `getRun` resolves to. */
export type ImportRunDetail = RunDetail;
/** The outcome of a cancellation request. `accepted: false` means unknown or already finished. */
export type ImportCancelResult = CancelResult;
/**
 * A single error recorded during a run.
 *
 * `errorCode` is a plain string upstream, not an enum, so expect values beyond
 * the documented ones. `CONFIGURATION` (something to change in the import's own
 * setup) and `EXTERNAL_SYSTEM` (another system answered with an error) are not
 * faults of the import, and their `message` is a sentence naming what to
 * change. `REJECTED_BY_SOURCE` fails one record because of its data — a
 * delimited-file row with too many array elements, say — while the rest of the
 * file is imported.
 */
export type ImportErrorRecord = ErrorRecord;
/** A record that was imported, with its keys, stored fields and last outcome. */
export type ImportedRecord = GenImportedRecord;

/**
 * A configuration's computed run order: `order` lists stream **names** in the
 * order they run, `prereqs` maps each name to the streams it waits for.
 */
export type ImportStreamOrder = GetImporttoolStreamOrderResponse;

/**
 * One file a file-based stream was given, and what became of it. `id` is what
 * `setStreamFileOrder` and `deleteStreamFile` take. `loadRank` is its place in
 * the drain order; `runId`, `processedAt` and `recordsRead` are set once a run
 * consumed it.
 */
export type ImportFile = GenImportFile;
/**
 * Where an {@link ImportFile} is in its life: `PENDING`, `IN_PROGRESS`,
 * `PROCESSED` or `FAILED`. A file whose records failed individually still ends
 * `PROCESSED`; `FAILED` means the stream reading it failed, and such a file can
 * be uploaded again.
 */
export type ImportFileStatus = NonNullable<ImportFile["status"]>;
/**
 * A stream's file queue: `pending` in load order, `history` newest first.
 * `pending` is complete up to 2000 files; beyond that `pendingTruncated` is
 * `true`, `pendingTotal` has the real count, and the order cannot be changed.
 */
export type ImportFileQueue = FileQueue;
/**
 * The upload limits of the environment: `maxUploadBytes`, whether the API
 * gateway rather than the service sets it (`gatewayLimited`), and whether
 * uploading is available at all (`uploadSupported`).
 */
export type ImportFileUploadLimits = GetImporttoolStreamFileLimitsResponse;

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
