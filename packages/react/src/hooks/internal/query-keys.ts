/**
 * Internal: build a stable, cache-keyed query identifier for SDK hooks.
 *
 * Shape: `["emporix", resource, ...args, { tenant, authKind, siteCode? }]`
 *
 * The trailing meta object groups discriminators that differentiate cache
 * entries across tenants, auth-kinds, and (where applicable) active sites.
 * `siteCode` is included only when explicitly passed — non-site-aware
 * hooks (e.g. `useSites` itself) pass `undefined` and the field is dropped.
 *
 * Centralizing this shape ensures consistency across ~20 read hooks and
 * makes future field additions (e.g. `language`) a single-file change.
 */
export function emporixKey<TArgs extends readonly unknown[]>(
  resource: string,
  args: TArgs,
  context: {
    tenant: string;
    authKind: string;
    siteCode?: string | null;
    language?: string | null;
  },
): readonly ["emporix", string, ...TArgs, Record<string, unknown>] {
  const meta: Record<string, unknown> = {
    tenant: context.tenant,
    authKind: context.authKind,
  };
  if (context.siteCode !== undefined) {
    meta.siteCode = context.siteCode;
  }
  if (context.language !== undefined) {
    meta.language = context.language;
  }
  return ["emporix", resource, ...args, meta] as const;
}

/** Which site discriminators go into the query key's meta object. */
export type SiteFields = "full" | "language" | "none";

/**
 * Builds the site portion of a query key's meta object. Shared by
 * `useEmporixQuery` (client) and `prefetchEmporix` (server) so the two cannot
 * disagree about which discriminators a resource carries — key parity is
 * structural, not tested.
 *
 * Note `null` is preserved rather than dropped: an unbound site is a distinct
 * cache identity from a bound one, and {@link emporixKey} only omits a field
 * when it is `undefined`.
 */
export function siteMeta(
  site: SiteFields,
  siteCode: string | null,
  language: string | null,
): { siteCode?: string | null; language?: string | null } {
  return site === "full"
    ? { siteCode, language }
    : site === "language"
      ? { language }
      : {};
}
