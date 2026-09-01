import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type { SseEvent } from "../core/sse";
import type { Page } from "../generated/import-service";
import type {
  ImportCancelResult,
  ImportConfig,
  ImportHealthThresholds,
  ImportJobGroup,
  ImportLicense,
  ImportStats,
  ImportStatsQuery,
  ImportErrorRecord,
  ImportPage,
  ImportRecordOutcome,
  ImportRun,
  ImportRunDetail,
  ImportRunEvent,
  ImportRunInput,
  ImportRunStream,
  ImportSchedule,
  ImportStream,
  ImportedRecord,
} from "./imports-types";

export type {
  ImportCancelResult,
  ImportConfig,
  ImportErrorRecord,
  ImportPage,
  ImportRecordOutcome,
  ImportRun,
  ImportRunDetail,
  ImportRunEvent,
  ImportRunInput,
  ImportRunMode,
  ImportRunStatus,
  ImportRunStream,
  ImportSchedule,
  ImportStream,
  ImportedRecord,
} from "./imports-types";

const SERVICE: AuthContext = { kind: "service" };
const DEFAULT_PAGE_SIZE = 50;

/** One-based paging options, shared by every paginated import endpoint. */
export interface ImportPageOptions {
  /** One-based page number. Default `1`. */
  pageNumber?: number;
  /** Page size. Default `50`. The service may clamp this — the result echoes what it used. */
  pageSize?: number;
}

/** Options for {@link ImportService.searchRecords}. `type` is required. */
export interface SearchImportedRecordsOptions extends ImportPageOptions {
  /** The target type to search, one of {@link ImportService.listDataTypes}. */
  type: string;
  /**
   * Case-insensitive substring match on the record's natural key. This is NOT
   * the Emporix query language — `field:value`, comparisons and boolean logic
   * are not supported here.
   */
  search?: string;
  /** Filter by import outcome. Omit for records of all outcomes. */
  outcome?: ImportRecordOutcome;
}

/** Options for {@link ImportService.searchStreamRecords}. */
export type SearchStreamRecordsOptions = Omit<SearchImportedRecordsOptions, "type">;

/** The wire shape of a paginated import response. */
type WirePage<T> = Page & { content?: T[] };

function pageArgs(opts: ImportPageOptions): { pageNumber: number; pageSize: number } {
  return { pageNumber: opts.pageNumber ?? 1, pageSize: opts.pageSize ?? DEFAULT_PAGE_SIZE };
}

/**
 * Spring page → {@link ImportPage}. `pageNumber` / `pageSize` prefer the
 * server's echo over what was requested, because the service clamps `size`;
 * reporting the requested value would misdescribe the page you actually got.
 */
function toPage<T>(
  wire: WirePage<T>,
  requested: { pageNumber: number; pageSize: number },
): ImportPage<T> {
  const totalPages = wire.totalPages ?? 0;
  const pageNumber = (wire.number ?? requested.pageNumber - 1) + 1;
  return {
    items: wire.content ?? [],
    pageNumber,
    pageSize: wire.size ?? requested.pageSize,
    hasNextPage: pageNumber < totalPages,
    totalElements: wire.totalElements ?? 0,
    totalPages,
  };
}

/**
 * One SSE frame → one typed event. Anything unparseable, non-object or under an
 * event name this SDK does not model becomes `unknown` instead of throwing: a
 * preview service is allowed to grow event types, and a run in flight must not
 * die because of one frame we cannot read.
 */
function toRunEvent(ev: SseEvent): ImportRunEvent {
  let payload: unknown;
  try {
    payload = JSON.parse(ev.data);
  } catch {
    return { type: "unknown", event: ev.event, data: ev.data };
  }
  if (typeof payload !== "object" || payload === null) {
    return { type: "unknown", event: ev.event, data: ev.data };
  }
  switch (ev.event) {
    case "snapshot": {
      const detail = payload as ImportRunDetail;
      return { type: "snapshot", run: detail.run, streams: detail.streams ?? [] };
    }
    case "stream":
      return { type: "stream", stream: payload as ImportRunStream };
    case "run":
      return { type: "run", run: payload as ImportRun };
    default:
      return { type: "unknown", event: ev.event, data: ev.data };
  }
}

/**
 * Emporix Import Service (`/importtool/{tenant}/…`): import configurations,
 * their streams and schedules, run control, and the records an import produced.
 *
 * **Service-account only.** Every operation requires the
 * `importtool.import_trigger` scope on the client credentials, and the service
 * has no customer or anonymous variant — which is why `@viu/emporix-sdk-react`
 * ships no hooks for it. Call it from a server (Node, a Next Route Handler or
 * Server Action), never from a browser bundle.
 *
 * **Paging is one-based here, zero-based on the wire.** The facade takes
 * `pageNumber` starting at 1 and sends `page = pageNumber - 1`, matching the
 * rest of the SDK.
 *
 * **Upstream marks every operation as preview**: the contract may change without
 * a major version bump, and nearly every response field is optional in the spec.
 * Treat run counters and status as possibly absent.
 */
export class ImportService {
  static readonly channel = "import" as const;

  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/importtool/${this.ctx.tenant}`;
  }

  /** List every import configuration of the tenant. */
  async listConfigs(auth: AuthContext = SERVICE): Promise<ImportConfig[]> {
    return this.ctx.http.request<ImportConfig[]>({
      method: "GET",
      path: `${this.base()}/configs`,
      auth,
    });
  }

  /** Fetch one configuration by id. */
  async getConfig(id: string, auth: AuthContext = SERVICE): Promise<ImportConfig> {
    return this.ctx.http.request<ImportConfig>({
      method: "GET",
      path: `${this.base()}/configs/${encodeURIComponent(id)}`,
      auth,
    });
  }

  /** List the streams of one configuration. */
  async listStreams(configId: string, auth: AuthContext = SERVICE): Promise<ImportStream[]> {
    return this.ctx.http.request<ImportStream[]>({
      method: "GET",
      path: `${this.base()}/configs/${encodeURIComponent(configId)}/streams`,
      auth,
    });
  }

  /** Fetch one stream by id. */
  async getStream(id: string, auth: AuthContext = SERVICE): Promise<ImportStream> {
    return this.ctx.http.request<ImportStream>({
      method: "GET",
      path: `${this.base()}/streams/${encodeURIComponent(id)}`,
      auth,
    });
  }

  /**
   * Fetch a configuration's schedule. Resolves to `null` when none is
   * configured — the service answers `204`, not `404`, so an absent schedule is
   * a normal result rather than an error.
   */
  async getSchedule(
    configId: string,
    auth: AuthContext = SERVICE,
  ): Promise<ImportSchedule | null> {
    const res = await this.ctx.http.request<ImportSchedule | undefined>({
      method: "GET",
      path: `${this.base()}/configs/${encodeURIComponent(configId)}/schedule`,
      auth,
    });
    return res ?? null;
  }

  /**
   * Create or replace a configuration's schedule.
   *
   * **`cron` is a six-field Spring expression** (`second minute hour
   * day-of-month month day-of-week`). The familiar five-field `"0 * * * *"` is
   * not «hourly» here, it is invalid, and the service answers `400` rather than
   * storing it — which it used to do, leaving a schedule that silently never
   * fired.
   *
   * A `404` means no configuration with that id, so there is nothing to
   * schedule. Use {@link deleteSchedule} to clear a schedule that outlived its
   * configuration.
   */
  async setSchedule(
    configId: string,
    input: ImportSchedule,
    auth: AuthContext = SERVICE,
  ): Promise<ImportSchedule> {
    return this.ctx.http.request<ImportSchedule>({
      method: "PUT",
      path: `${this.base()}/configs/${encodeURIComponent(configId)}/schedule`,
      body: input,
      auth,
    });
  }

  /**
   * Remove a configuration's schedule. It then runs only when triggered.
   *
   * **Idempotent, and deliberately not gated on the configuration existing.**
   * Removing a schedule that is not there also resolves — and unlike
   * {@link setSchedule}, this does not require the configuration to exist. That
   * is the point: a schedule left behind by a deleted configuration is exactly
   * what needs removing, so refusing those would leave them with no way out.
   *
   * The service answers `204`, so this resolves to `void` rather than to the
   * removed schedule.
   */
  async deleteSchedule(configId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/configs/${encodeURIComponent(configId)}/schedule`,
      auth,
    });
  }

  /**
   * Trigger a run. `mode` defaults to `DELTA` server-side; `dryRun: true` maps
   * and validates without writing to the target.
   *
   * A dry run can also hand back what it *would* have written: pass
   * `sampleSize` (1–100, default 25) and read the run's `dryRunSample`. Set
   * `origin` to name what asked for the run — `trigger` only distinguishes
   * `MANUAL` from `SCHEDULED`, so without it a dashboard click and an
   * integration scenario are indistinguishable in the history. Note the service
   * **rejects** an `origin` over 40 characters instead of shortening it.
   *
   * Not retried on a 5xx: a POST that timed out may already have queued a run.
   *
   * @example
   * ```ts
   * // Preview the mapping without writing anything.
   * const run = await client.imports.triggerRun(configId, {
   *   dryRun: true,
   *   sampleSize: 5,
   *   origin: "Dashboard",
   * });
   * for (const row of run.dryRunSample ?? []) {
   *   console.log(row.stream, row.targetType, row.key, row.fields);
   * }
   * ```
   */
  async triggerRun(
    configId: string,
    input: ImportRunInput = {},
    auth: AuthContext = SERVICE,
  ): Promise<ImportRun> {
    return this.ctx.http.request<ImportRun>({
      method: "POST",
      path: `${this.base()}/configs/${encodeURIComponent(configId)}/runs`,
      body: input,
      auth,
    });
  }

  /** List a configuration's runs, newest first. */
  async listRuns(
    configId: string,
    opts: ImportPageOptions = {},
    auth: AuthContext = SERVICE,
  ): Promise<ImportPage<ImportRun>> {
    const args = pageArgs(opts);
    const wire = await this.ctx.http.request<WirePage<ImportRun>>({
      method: "GET",
      path: `${this.base()}/configs/${encodeURIComponent(configId)}/runs`,
      query: { page: args.pageNumber - 1, size: args.pageSize },
      auth,
    });
    return toPage(wire, args);
  }

  /** Fetch one run with its per-stream progress. */
  async getRun(runId: string, auth: AuthContext = SERVICE): Promise<ImportRunDetail> {
    return this.ctx.http.request<ImportRunDetail>({
      method: "GET",
      path: `${this.base()}/runs/${encodeURIComponent(runId)}`,
      auth,
    });
  }

  /**
   * Stream a run's progress as Server-Sent Events: an initial `snapshot`, then a
   * `stream` event per processed batch, then a final `run` event when the run
   * finishes. The iterator ends when the service closes the stream; breaking out
   * of the `for await` aborts the request.
   *
   * Two ways this differs from every other method here. It does not re-auth: a
   * `401` while opening the stream throws instead of minting a fresh token and
   * retrying once, so a long-lived consumer should be ready to re-open (or fall
   * back to polling {@link getRun}). And frames this SDK version cannot read
   * arrive as `{ type: "unknown" }` rather than throwing — see
   * {@link ImportRunEvent}.
   */
  async *streamRun(
    runId: string,
    auth: AuthContext = SERVICE,
  ): AsyncIterable<ImportRunEvent> {
    const frames = this.ctx.http.requestStream({
      method: "GET",
      path: `${this.base()}/runs/${encodeURIComponent(runId)}/events`,
      auth,
    });
    for await (const frame of frames) yield toRunEvent(frame);
  }

  /**
   * Request cancellation of a run. `force: true` hard-stops it immediately;
   * without it the run stops at the next safe point. The service answers `202`
   * with `accepted: false` when the run is unknown or already finished — that is
   * a result, not an error. A state conflict may instead come back as a `409`,
   * which does throw.
   */
  async cancelRun(
    runId: string,
    opts: { force?: boolean } = {},
    auth: AuthContext = SERVICE,
  ): Promise<ImportCancelResult> {
    const query: Record<string, string | number | undefined> = {};
    if (opts.force) query.force = "true";
    return this.ctx.http.request<ImportCancelResult>({
      method: "POST",
      path: `${this.base()}/runs/${encodeURIComponent(runId)}/cancel`,
      query,
      auth,
    });
  }

  /** List the errors recorded during a run. */
  async listRunErrors(
    runId: string,
    opts: ImportPageOptions = {},
    auth: AuthContext = SERVICE,
  ): Promise<ImportPage<ImportErrorRecord>> {
    const args = pageArgs(opts);
    const wire = await this.ctx.http.request<WirePage<ImportErrorRecord>>({
      method: "GET",
      path: `${this.base()}/runs/${encodeURIComponent(runId)}/errors`,
      query: { page: args.pageNumber - 1, size: args.pageSize },
      auth,
    });
    return toPage(wire, args);
  }

  /** List the target types that hold imported records — the valid `type` values for {@link searchRecords}. */
  async listDataTypes(auth: AuthContext = SERVICE): Promise<string[]> {
    return this.ctx.http.request<string[]>({
      method: "GET",
      path: `${this.base()}/data/types`,
      auth,
    });
  }

  /** Search imported records of one target type. */
  async searchRecords(
    opts: SearchImportedRecordsOptions,
    auth: AuthContext = SERVICE,
  ): Promise<ImportPage<ImportedRecord>> {
    const args = pageArgs(opts);
    const query: Record<string, string | number | undefined> = {
      type: opts.type,
      page: args.pageNumber - 1,
      size: args.pageSize,
    };
    if (opts.search !== undefined) query.search = opts.search;
    if (opts.outcome !== undefined) query.outcome = opts.outcome;
    const wire = await this.ctx.http.request<WirePage<ImportedRecord>>({
      method: "GET",
      path: `${this.base()}/data/records`,
      query,
      auth,
    });
    return toPage(wire, args);
  }

  /** Search the imported records produced by one stream. */
  async searchStreamRecords(
    streamId: string,
    opts: SearchStreamRecordsOptions = {},
    auth: AuthContext = SERVICE,
  ): Promise<ImportPage<ImportedRecord>> {
    const args = pageArgs(opts);
    const query: Record<string, string | number | undefined> = {
      page: args.pageNumber - 1,
      size: args.pageSize,
    };
    if (opts.search !== undefined) query.search = opts.search;
    if (opts.outcome !== undefined) query.outcome = opts.outcome;
    const wire = await this.ctx.http.request<WirePage<ImportedRecord>>({
      method: "GET",
      path: `${this.base()}/data/streams/${encodeURIComponent(streamId)}/records`,
      query,
      auth,
    });
    return toPage(wire, args);
  }

  // ─── Analytics and retry (upstream release 2026-08-26) ─────────────────────

  /**
   * Aggregated import analytics.
   *
   * Every section is optional in the response, and `sections` is what decides
   * which the service computes — asking for all of them on a tenant with a long
   * history is the expensive call, so name the ones you render.
   *
   * `from` / `to` are ISO timestamps. Omitted, the service picks its own window;
   * do not assume it is «everything».
   *
   * **Preview upstream**: the contract may change without a major bump.
   */
  async stats(
    query: ImportStatsQuery = {},
    auth: AuthContext = SERVICE,
  ): Promise<ImportStats> {
    return this.ctx.http.request<ImportStats>({
      method: "GET",
      path: `${this.base()}/stats`,
      query: { ...query },
      auth,
    });
  }

  /**
   * The dashboard's job groups: configurations with their runs grouped under
   * them.
   *
   * Named after the path rather than the summary («Retrieving job groups»)
   * because the resource lives under `/dashboard` and is shaped for that view —
   * a caller wanting plain run history wants {@link listRuns}.
   *
   * **Preview upstream**: the contract may change without a major bump.
   */
  async listJobGroups(auth: AuthContext = SERVICE): Promise<ImportJobGroup[]> {
    return this.ctx.http.request<ImportJobGroup[]>({
      method: "GET",
      path: `${this.base()}/dashboard/job-groups`,
      auth,
    });
  }

  /**
   * The tenant's health thresholds — the error rates above which a stream counts
   * as degraded or failing in {@link stats}.
   *
   * Read-only here: changing them needs `importtool.import_manage`, which this
   * service does not cover.
   *
   * **Preview upstream**: the contract may change without a major bump.
   */
  async getHealthThresholds(
    auth: AuthContext = SERVICE,
  ): Promise<ImportHealthThresholds> {
    return this.ctx.http.request<ImportHealthThresholds>({
      method: "GET",
      path: `${this.base()}/settings/health-thresholds`,
      auth,
    });
  }

  /**
   * The tenant's import limits and current consumption.
   *
   * **Preview upstream**: the contract may change without a major bump.
   */
  async getLicense(auth: AuthContext = SERVICE): Promise<ImportLicense> {
    return this.ctx.http.request<ImportLicense>({
      method: "GET",
      path: `${this.base()}/license`,
      auth,
    });
  }

  /**
   * Retry only the failed records of a finished run.
   *
   * Returns a **new** run — the retry is its own run with `retry: true`, not a
   * mutation of the original. Poll it with {@link getRun} or follow it with
   * {@link streamRun} exactly as you would a triggered run.
   *
   * Not retried on a 5xx, for the same reason {@link triggerRun} is not: a POST
   * that timed out may already have queued the retry.
   *
   * **Preview upstream**: the contract may change without a major bump.
   */
  async retryRun(runId: string, auth: AuthContext = SERVICE): Promise<ImportRun> {
    return this.ctx.http.request<ImportRun>({
      method: "POST",
      path: `${this.base()}/runs/${encodeURIComponent(runId)}/retry`,
      auth,
    });
  }

}
