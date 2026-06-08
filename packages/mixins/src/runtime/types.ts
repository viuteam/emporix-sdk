export type JsonSchema = Record<string, unknown>;

/** Structural shape every Emporix entity matches — no tenant/entity knowledge needed. */
export interface HasMixins {
  mixins?: Record<string, unknown>;
  metadata?: { mixins?: Record<string, string> };
}

/** Identifies one mixin and how to resolve it. Generated per tenant, consumed by the runtime. */
export interface MixinDescriptor<T = unknown> {
  key: string;
  entity: string;
  url: string;
  version: number;
  schema?: JsonSchema;
  readonly __type?: T;
}
