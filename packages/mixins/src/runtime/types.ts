export type JsonSchema = Record<string, unknown>;

/**
 * Structural shape every Emporix entity matches — no tenant/entity knowledge
 * needed. Optionals are `| undefined` so entities typed under
 * `exactOptionalPropertyTypes` (where `prop?: X` reads as `X | undefined`)
 * assign cleanly — including entities whose `metadata` carries no `mixins`.
 */
export interface HasMixins {
  mixins?: Record<string, unknown> | undefined;
  metadata?: { mixins?: Record<string, unknown> | undefined } | undefined;
}

/** Identifies one mixin and how to resolve it. Generated per tenant, consumed by the runtime. */
export interface MixinDescriptor<T = unknown, E extends string = string> {
  key: string;
  entity: E;
  url: string;
  version: number;
  schema?: JsonSchema;
  readonly __type?: T;
}
