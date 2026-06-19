/**
 * Public types for the Indexing Service — stable names aliased over the
 * generated `indexing-service` types.
 */
import type {
  IndexConfiguration,
  IndexCreationResponse,
  IndexPublicConfiguration,
  Reindex,
  ReindexJob as GenReindexJob,
  ReindexRequest,
  ReindexEntityType as GenReindexEntityType,
  ReindexJobStatus as GenReindexJobStatus,
} from "../generated/indexing-service";

/** An indexing configuration (read + write body). */
export type IndexConfig = IndexConfiguration;
/** `POST /configurations` response. */
export type IndexConfigCreated = IndexCreationResponse;
/** A public indexing configuration. */
export type IndexPublicConfig = IndexPublicConfiguration;

/** A reindex job — tracks the progress of a `FULL` reindex. */
export type ReindexJob = GenReindexJob;
/** Body for `createReindexJob`: `{ entityType, rag? }` (`entityType` required). */
export type ReindexJobInput = ReindexRequest;
/** Entity type to reindex — `"PRODUCT"` or a custom schema type. */
export type ReindexEntityType = GenReindexEntityType;
/** Lifecycle status of a {@link ReindexJob}. */
export type ReindexJobStatus = GenReindexJobStatus;

/**
 * Body for the legacy `reindex` endpoint.
 * @deprecated since 2026-06-18, removal 2026-12-01 — use {@link ReindexJobInput} with
 * `IndexingService.createReindexJob`.
 */
export type ReindexInput = Reindex;
