import type {
  SequenceSchema as GenSequenceSchema,
  SequenceSchemaCreate as GenSequenceSchemaCreate,
  NextIdCommandRequest as GenNextIdCommandRequest,
} from "../generated/sequential-id";

/**
 * A sequence schema as returned by the service — a counter template plus the
 * server-managed `id`, `active` flag, `counter`, and `metadata`.
 */
export type SequenceSchema = GenSequenceSchema;

/**
 * Body for {@link SequentialIdService.createSchema}. Schemas are immutable
 * (no PATCH/PUT upstream) — to change one, delete it and create a new one.
 */
export type SequenceSchemaCreate = GenSequenceSchemaCreate;

/**
 * Body for a single next-id request: optional sub-pool key + placeholder values.
 * The generated spec widens `placeholders` to `unknown`; the SDK types it as the
 * documented `key → value` string map.
 */
export type NextIdCommandRequest = Omit<GenNextIdCommandRequest, "placeholders"> & {
  placeholders?: Record<string, string>;
};

/** The generated id returned by `nextId` (always present on a successful call). */
export interface NextIdResponse {
  id: string;
}

/** Per-call options for {@link SequentialIdService.nextId}. */
export interface NextIdOptions {
  /**
   * A site code. When set, the service derives time/country placeholders from
   * that site's settings. Serialized to the `?siteCode=` query param.
   */
  siteCode?: string;
}

/** One entry in a batch next-ids request, keyed by schema type. */
export interface BatchNextIdEntry {
  /** How many ids to allocate for this schema type. */
  numberOfIds: number;
  /** Optional independent sub-pool counter key. */
  sequenceKey?: string;
  /** Placeholder values substituted into the generated ids. */
  placeholders?: Record<string, string>;
}

/** Batch next-ids request: a map of `schemaType` → allocation request. */
export type NextIdsBatchRequest = Record<string, BatchNextIdEntry>;

/** Batch next-ids response: a map of `schemaType` → the generated ids. */
export type NextIdsBatchResponse = Record<string, { ids: string[] }>;
