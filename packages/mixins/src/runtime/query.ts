import type { MixinDescriptor } from "./types";

/** A built `q` filter. Produced by {@link mixinQuery}/{@link and}/{@link or}/{@link raw}. */
export interface MixinFilter<E extends string = string> {
  /** The `q` fragment, parenthesized when compound. */
  toString(): string;
  /** Alias of {@link toString}. */
  build(): string;
  /** True when the fragment contains a `compoundLogicalQuery` (from `or()`). */
  readonly usesCompound: boolean;
  /** Phantom field carrying the entity for structural gating in the SDK. */
  readonly __entity?: E;
}

/** Operator objects for an attribute of value type `V`, gated by `V`. */
export type MixinOps<V> =
  | { eq: V }
  | { exists: boolean }
  | (V extends string ? { in: readonly string[] } | { regex: string } : never)
  | (V extends number
      ?
          | { in: readonly number[] }
          | { gt: number }
          | { gte: number }
          | { lt: number }
          | { lte: number }
          | { gte: number; lte: number }
          | { gt: number; lt: number }
      : never);

/**
 * Localized-field operators. `lang` selects the language segment, so the clause
 * targets `mixins.<key>.<attr>.<lang>` (localized values are stored language-keyed).
 */
export type LocalizedOps =
  | { lang: string; eq: string }
  | { lang: string; in: readonly string[] }
  | { lang: string; regex: string }
  | { lang: string; exists: boolean };

/** A `where` entry: a bare value (equals), an operator object, or a localized operator object. */
export type MixinWhereValue<V> = V | MixinOps<V> | LocalizedOps;

/** Type-safe `where` map over a mixin's attributes. */
export type MixinWhere<T> = {
  [K in keyof T]?: MixinWhereValue<NonNullable<T[K]>>;
};

function makeFilter<E extends string>(fragment: string, usesCompound: boolean): MixinFilter<E> {
  return {
    usesCompound,
    toString: () => fragment,
    build: () => fragment,
  };
}

function formatScalar(v: unknown): string {
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  const s = String(v);
  if (/\s/.test(s)) {
    throw new Error(
      `mixinQuery: value "${s}" contains whitespace. The Emporix q DSL uses spaces as AND ` +
        `separators and the safe escaping is unverified — pass a whitespace-free value or use raw().`,
    );
  }
  return s;
}

function renderClause(path: string, val: unknown): string {
  if (val === null || typeof val !== "object") {
    return `${path}:${formatScalar(val)}`;
  }
  const o = val as Record<string, unknown>;
  if ("lang" in o) {
    const { lang, ...rest } = o;
    return renderClause(`${path}.${String(lang)}`, rest);
  }
  if ("exists" in o) return `${path}:${o.exists ? "exists" : "missing"}`;
  if ("eq" in o) return `${path}:${formatScalar(o.eq)}`;
  if ("in" in o) return `${path}:(${(o.in as unknown[]).map(formatScalar).join(",")})`;
  if ("regex" in o) return `${path}:~${String(o.regex)}`;
  const parts: string[] = [];
  if ("gte" in o) parts.push(`>=${String(o.gte)}`);
  if ("gt" in o) parts.push(`>${String(o.gt)}`);
  if ("lte" in o) parts.push(`<=${String(o.lte)}`);
  if ("lt" in o) parts.push(`<${String(o.lt)}`);
  if (parts.length === 0) {
    throw new Error(
      `mixinQuery: unsupported value for "${path}" (no operator keys).`,
    );
  }
  if (parts.length === 1) return `${path}:${parts[0]}`;
  return `${path}:(${parts.join(" AND ")})`;
}

/** Builds a `q` filter for one mixin's attributes. Multiple keys are ANDed (space-joined). */
export function mixinQuery<T, E extends string>(
  descriptor: MixinDescriptor<T, E>,
  where: MixinWhere<T>,
  opts?: { prefix?: string },
): MixinFilter<E> {
  const base = opts?.prefix
    ? `${opts.prefix}.mixins.${descriptor.key}`
    : `mixins.${descriptor.key}`;
  const clauses: string[] = [];
  for (const attr of Object.keys(where)) {
    const val = (where as Record<string, unknown>)[attr];
    if (val === undefined) continue;
    clauses.push(renderClause(`${base}.${attr}`, val));
  }
  if (clauses.length === 0) {
    throw new Error(`mixinQuery: empty where for mixin "${descriptor.key}".`);
  }
  return makeFilter<E>(clauses.join(" "), false);
}

// `E` is pinned to the FIRST filter; the rest are `NoInfer` so they must match
// it exactly — composing filters from two different entities is a compile error.

/** Combines filters with AND. Space-joins unless a child is compound, then uses compoundLogicalQuery. */
export function and<E extends string>(
  first: MixinFilter<E>,
  ...rest: NoInfer<MixinFilter<E>>[]
): MixinFilter<E> {
  const filters = [first, ...rest];
  if (filters.some((f) => f.usesCompound)) {
    const inner = filters.map((f) => `(${f.toString()})`).join(" AND ");
    return makeFilter<E>(`compoundLogicalQuery:(${inner})`, true);
  }
  return makeFilter<E>(filters.map((f) => f.toString()).join(" "), false);
}

/** Combines filters with OR via compoundLogicalQuery (only valid on compound-capable services). */
export function or<E extends string>(
  first: MixinFilter<E>,
  ...rest: NoInfer<MixinFilter<E>>[]
): MixinFilter<E> {
  const inner = [first, ...rest].map((f) => `(${f.toString()})`).join(" OR ");
  return makeFilter<E>(`compoundLogicalQuery:(${inner})`, true);
}

/**
 * Escape hatch: wrap a raw q fragment (e.g. a non-mixin clause). The entity `E`
 * is inferred from the surrounding `and()`/`or()` so it composes with any entity.
 */
export function raw<E extends string = string>(fragment: string): MixinFilter<E> {
  return makeFilter<E>(fragment, false);
}
