import type { JsonSchema } from "../runtime/types";

/** A mixin normalized from any source. */
export interface RawMixin {
  key: string;
  entity: string;
  version: number;
  url: string;
  schema: JsonSchema;
}

/** A pluggable source of mixins (Schema Service, terraform output, files, …). */
export interface MixinSource {
  list(): Promise<RawMixin[]>;
}
