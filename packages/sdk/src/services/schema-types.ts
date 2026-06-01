import type {
  SchemaResponse,
  SchemaAttribute as GenSchemaAttribute,
  SchemaType as GenSchemaType,
  CustomSchemaTypeResponse,
  CustomInstanceResponse,
} from "../generated/schema";

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
  [key: string]: string | number | undefined;
}

/** Options for {@link SchemaService.listCustomEntities}. */
export interface ListCustomEntitiesOptions {
  /** Inline each entity's schema body in the response. */
  expandSchemas?: boolean;
}

/** Structured search filter body for {@link SchemaService.searchInstances}. */
export type InstanceSearchBody = Record<string, unknown>;
