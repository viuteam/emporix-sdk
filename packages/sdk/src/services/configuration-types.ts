import type { BaseConfiguration } from "../generated/configuration";

/**
 * A tenant configuration entry. The wire `value` is "any JSON"; the SDK
 * lets callers pin it with a generic (defaults to `unknown`). All other
 * fields mirror the upstream `BaseConfiguration` schema.
 */
export type Configuration<T = unknown> = Omit<BaseConfiguration, "value"> & { value: T };

/** A per-client configuration entry; adds the server-assigned `_id` and `client`. */
export type ClientConfiguration<T = unknown> = Configuration<T> & { _id: string; client: string };

/** Input for create/update. Omits server-managed fields (`version`, `_id`). */
export interface ConfigurationDraft<T = unknown> {
  key: string;
  value: T;
  description?: string;
  /** Encrypts a string `value` at rest. */
  secured?: boolean;
  /** When true, the entry cannot be deleted. Cannot be unset once true. */
  restricted?: boolean;
  /** When true, the entry cannot be updated. */
  readOnly?: boolean;
  /** URL of a JSON Schema used to validate `value`. Immutable once set. */
  schemaUrl?: string;
}

/** Options for the list endpoints. `keys` is serialized to a CSV query param. */
export interface ListConfigOptions {
  keys?: string[];
}
