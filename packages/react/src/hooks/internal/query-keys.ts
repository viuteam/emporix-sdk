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
  },
): readonly ["emporix", string, ...TArgs, Record<string, unknown>] {
  const meta: Record<string, unknown> = {
    tenant: context.tenant,
    authKind: context.authKind,
  };
  if (context.siteCode !== undefined) {
    meta.siteCode = context.siteCode;
  }
  return ["emporix", resource, ...args, meta] as const;
}
