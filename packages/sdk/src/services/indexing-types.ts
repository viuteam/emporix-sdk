/**
 * Public types for the Indexing Service — stable names aliased over the
 * generated `indexing-service` types.
 */
import type {
  IndexConfiguration,
  IndexCreationResponse,
  IndexPublicConfiguration,
  Reindex,
} from "../generated/indexing-service";

/** An indexing configuration (read + write body). */
export type IndexConfig = IndexConfiguration;
/** `POST /configurations` response. */
export type IndexConfigCreated = IndexCreationResponse;
/** A public indexing configuration. */
export type IndexPublicConfig = IndexPublicConfiguration;
/** Body for `reindex`. */
export type ReindexInput = Reindex;
