/**
 * A built query filter — structurally matched, NOT imported, so the SDK stays
 * decoupled from `@viu/emporix-mixins` (which lists the SDK as an optional
 * peer; a real import would be circular). `@viu/emporix-mixins`' `MixinFilter<E>`
 * satisfies this shape.
 */
export interface BuiltQuery<E extends string = string> {
  toString(): string;
  readonly usesCompound?: boolean;
  /** Phantom entity tag — gates which service a filter may be passed to. */
  readonly __entity?: E;
}

/** A `q` value a service method accepts: a raw DSL string or a built filter for entity `E`. */
export type QueryFor<E extends string = string> = string | BuiltQuery<E>;

/** Per-service capability flags consulted by {@link resolveQuery}. */
export interface QueryCapability {
  /** Whether the target service supports the `compoundLogicalQuery` (OR) operator. */
  compoundLogicalQuery: boolean;
}

/**
 * Normalizes a `string | BuiltQuery` into a `q` string and enforces the
 * `compoundLogicalQuery` capability gate: an `or()`-built filter passed to a
 * service that does not support it throws rather than silently producing a
 * query the backend cannot execute.
 */
export function resolveQuery(q: QueryFor, cap: QueryCapability): string {
  if (typeof q === "string") return q;
  if (q.usesCompound === true && !cap.compoundLogicalQuery) {
    throw new Error(
      "This filter uses or()/compoundLogicalQuery, which the target service does not support. " +
        "Combine conditions with and() (space-separated AND) instead.",
    );
  }
  return q.toString();
}
