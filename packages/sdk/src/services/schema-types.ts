import type {
  SchemaResponse,
  SchemaAttribute as GenSchemaAttribute,
  SchemaType as GenSchemaType,
  CustomSchemaTypeResponse,
  CustomInstanceResponse,
  BulkPatchCustomInstanceRequest as GenBulkPatchInstanceItem,
  BulkResponse as GenBulkResponse,
  ReferenceResponse,
  ReferenceCreation,
  ReferenceUpdate,
  IdResponse,
  CustomInstanceCreation,
  CustomInstanceUpdate,
  ExportImportRequest,
  ExportImportResponse,
} from "../generated/schema";

/** One item for {@link SchemaService.bulkPatchInstances} — `{ id, data: op[] }`. */
export type BulkPatchInstanceItem = GenBulkPatchInstanceItem;
/** Per-item results of a bulk operation (207) — `{ index?, code?, status?, message?, details? }[]`. */
export type BulkInstanceResult = GenBulkResponse;

/** A schema definition (typed attributes attached to one or more entity types). */
export type Schema = SchemaResponse;

/** A single typed attribute within a schema (recursive for `OBJECT`). */
export type SchemaAttribute = GenSchemaAttribute;

/**
 * The set of native entity types a schema can attach to
 * (`PRODUCT`, `CART`, `ORDER`, `CUSTOM_ENTITY`, …).
 */
export type SchemaTypeName = GenSchemaType;

/** A custom-entity definition (a tenant-defined resource type). */
export type CustomEntity = CustomSchemaTypeResponse;

/**
 * A custom-entity data record. The wire `mixins` field is loosely typed
 * upstream; the SDK lets callers pin it with a generic (defaults to an open
 * record). All other fields mirror the upstream `CustomInstanceResponse`.
 */
export type CustomInstance<T = Record<string, unknown>> = Omit<
  CustomInstanceResponse,
  "mixins"
> & { mixins: T };

/**
 * Input for creating a schema (server assigns `metadata.version`/`url`).
 * `name`, `types` and `attributes` are the caller-controlled fields.
 */
export interface SchemaDraft {
  name: Record<string, string>;
  types: SchemaTypeName[];
  attributes: SchemaAttribute[];
}

/**
 * Input for updating a schema. Identical to {@link SchemaDraft} but the
 * upstream API **requires** `metadata.version` for optimistic locking
 * (409 Conflict on a stale version).
 */
export interface SchemaUpdate extends SchemaDraft {
  metadata: { version: number };
}

/** Input for creating/updating a custom-entity definition. */
export interface CustomEntityDraft {
  name: Record<string, string>;
  attributes: SchemaAttribute[];
}

/** Input for creating/replacing a custom instance. `mixins` carries the data. */
export interface CustomInstanceDraft<T = Record<string, unknown>> {
  name: Record<string, string>;
  mixins: T;
}

/** Filter / pagination options for {@link SchemaService.listSchemas}. */
export interface ListSchemasQuery {
  /** Emporix `q`-syntax filter (supports `compoundLogicalQuery`). */
  q?: string;
  /** Restrict to schemas attached to this entity type. */
  type?: SchemaTypeName;
  pageNumber?: number;
  pageSize?: number;
}

/**
 * Pagination options for {@link SchemaService.listInstances}. The index
 * signature stays open so additional Emporix query params pass through.
 */
export interface ListInstancesQuery {
  pageNumber?: number;
  pageSize?: number;
  /**
   * Opaque cursor from a previous page's `nextCursor`. Sending it switches the
   * server to cursor pagination: `pageNumber` is ignored and no total is
   * returned. Cannot be combined with {@link prev} — the server answers 400.
   */
  next?: string;
  /** Opaque cursor from a previous page's `prevCursor`. See {@link next}. */
  prev?: string;
  /**
   * Ask for `X-Total-Count`. An SDK-side flag, not an Emporix query parameter:
   * it becomes a request header. Ignored by the server in cursor mode.
   */
  totalCount?: boolean;
  [key: string]: string | number | boolean | undefined;
}

/** Options for {@link SchemaService.listCustomEntities}. */
export interface ListCustomEntitiesOptions {
  /** Inline each entity's schema body in the response. */
  expandSchemas?: boolean;
}

/** Structured search filter body for {@link SchemaService.searchInstances}. */
export type InstanceSearchBody = Record<string, unknown>;

/** Pagination, sorting and cursor options for {@link SchemaService.searchInstances}. */
export interface SearchInstancesQuery {
  pageNumber?: number;
  pageSize?: number;
  /** e.g. `"_id:ASC"`. The server appends `_id:ASC` as a tie-breaker if absent. */
  sort?: string;
  /** See {@link ListInstancesQuery.next}. */
  next?: string;
  /** See {@link ListInstancesQuery.prev}. */
  prev?: string;
  /** Ask for `X-Total-Count`. Ignored by the server in cursor mode. */
  totalCount?: boolean;
}

/** A reference entity (a schema attached to an uploaded JSON file). */
export type SchemaReference = ReferenceResponse;

/** Metadata part for creating a reference. */
export type SchemaReferenceInput = ReferenceCreation;

/** Metadata part for updating a reference. */
export type SchemaReferenceUpdateInput = ReferenceUpdate;

/** Id envelope returned when a reference is created. */
export type SchemaReferenceCreated = IdResponse;

/** One item for {@link SchemaService.bulkCreateInstances}. */
export type SchemaInstanceBulkCreateItem = CustomInstanceCreation;

/** One item for {@link SchemaService.bulkUpsertInstances} — an update plus its id. */
export type SchemaInstanceBulkUpsertItem = { id: string } & CustomInstanceUpdate;

/** Result of a custom-entity export — base64 `data` plus `exportedAt`. */
export type SchemaExport = ExportImportResponse;

/** Body for a custom-entity import — the base64 `data` produced by an export. */
export type SchemaImportInput = ExportImportRequest;

/** Filter / pagination options for `schema.references.list`. */
export interface ListSchemaReferencesQuery {
  pageNumber?: number;
  pageSize?: number;
  sort?: string;
  q?: string;
  fields?: string;
  /** Restrict to references attached to this entity type (e.g. `PRODUCT`). */
  type?: string;
}
