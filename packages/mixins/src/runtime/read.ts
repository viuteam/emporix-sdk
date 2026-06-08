import type { HasMixins, MixinDescriptor } from "./types";
import { savedMixinVersion } from "./version";

/**
 * Reads a typed mixin off any entity. Returns `undefined` when absent. Emits a
 * `console.warn` when the entity's saved version differs from the descriptor
 * (drift signal). Never throws. Validate explicitly via `validateMixin`.
 */
export function readMixin<T>(entity: HasMixins, d: MixinDescriptor<T>): T | undefined {
  const value = entity.mixins?.[d.key] as T | undefined;
  if (value === undefined) return undefined;
  const saved = savedMixinVersion(entity, d.key);
  if (saved !== undefined && saved !== d.version) {
    // eslint-disable-next-line no-console
    console.warn(
      `[emporix-mixins] "${d.key}": entity carries v${saved} but the loaded type is v${d.version}`,
    );
  }
  return value;
}
