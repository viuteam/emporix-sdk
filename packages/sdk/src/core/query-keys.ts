/**
 * The cache-key shape every framework binding shares.
 *
 * Shape: `["emporix", resource, ...args, { tenant, authKind, siteCode?, language? }]`
 *
 * It lives in the core SDK for the same reason {@link STORAGE_KEYS} does: it is
 * not a React concern. `@viu/emporix-sdk-react` and `@viu/emporix-sdk-angular`
 * must produce byte-identical keys or the two bindings, the docs and the
 * devtools all describe different caches. One definition is the only way that
 * holds — a copy per binding would agree on the day it was written and nowhere
 * after.
 *
 * The trailing meta object groups the discriminators that differentiate cache
 * entries across tenants, auth-kinds and (where applicable) active sites.
 * `siteCode` is included only when explicitly passed — non-site-aware reads
 * pass `undefined` and the field is dropped.
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
 * Builds the site portion of a query key's meta object. Shared by every read
 * path — React's `useEmporixQuery`, its `prefetchEmporix`, and Angular's
 * `emporixQueryOptions` — so none of them can disagree about which
 * discriminators a resource carries. Key parity is structural, not tested.
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
