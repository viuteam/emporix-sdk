import type { HasMixins, MixinDescriptor } from "./types";

/** Sets `mixins[key]=value` AND `metadata.mixins[key]=descriptor.url` on a (partial) body. */
export function writeMixin<T, B extends object>(
  body: B,
  d: MixinDescriptor<T>,
  value: T,
): B & HasMixins {
  const b = body as B & HasMixins;
  return {
    ...b,
    mixins: { ...(b.mixins ?? {}), [d.key]: value },
    metadata: { ...(b.metadata ?? {}), mixins: { ...(b.metadata?.mixins ?? {}), [d.key]: d.url } },
  };
}
