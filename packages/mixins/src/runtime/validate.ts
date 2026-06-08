import type { MixinDescriptor } from "./types";

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

interface AjvLike {
  compile: (s: unknown) => ((v: unknown) => boolean) & {
    errors?: Array<{ instancePath: string; message?: string }> | null;
  };
}

/**
 * Validates a value against the descriptor's JSON Schema using `ajv`. Async +
 * lazy-imported so the runtime entry stays browser-safe and ajv-free unless
 * validation is actually used. No schema → always valid.
 */
export async function validateMixin<T>(
  value: unknown,
  d: MixinDescriptor<T>,
): Promise<ValidationResult> {
  if (!d.schema) return { valid: true };
  let AjvCtor: new (opts?: unknown) => AjvLike;
  try {
    const mod = (await import("ajv")) as unknown as { default: new (opts?: unknown) => AjvLike };
    AjvCtor = mod.default;
  } catch {
    throw new Error(
      "[emporix-mixins] validation needs the optional peer 'ajv'. Install it: pnpm add ajv",
    );
  }
  const ajv = new AjvCtor({ allErrors: true, strict: false });
  const validate = ajv.compile(d.schema);
  const ok = validate(value);
  if (ok) return { valid: true };
  return {
    valid: false,
    errors: (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message ?? "invalid"}`.trim()),
  };
}
