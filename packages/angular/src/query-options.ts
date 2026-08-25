import { auth, emporixKey, siteMeta, type AuthContext, type SiteFields } from "@viu/emporix-sdk";

/** What the caller of a read injectable describes: the resource, not the session. */
export interface EmporixQueryInput<T, TArgs extends readonly unknown[]> {
  resource: string;
  args: TArgs;
  /** Which site discriminators belong in the cache key. */
  site: SiteFields;
  /** Receives the resolved auth context. */
  queryFn: (ctx: AuthContext) => Promise<T>;
  /**
   * `read-auth` — customer if a token is stored, anonymous otherwise.
   * `customer` — token-gated: keyed either way, enabled only with a token.
   */
  mode: "read-auth" | "customer";
  /** Per-call override. Ignored in `customer` mode, which is gated by definition. */
  authOverride?: AuthContext;
  staleTime?: number;
  /** ANDed with the internal gate, never replacing it. */
  enabled?: boolean;
}

/** The session state a read depends on, read from signals by the caller. */
export interface EmporixQueryContext {
  tenant: string;
  token: string | null;
  siteCode: string | null;
  language: string | null;
}

/** What TanStack needs, and nothing else. */
export interface EmporixQueryOptions<T> {
  queryKey: readonly unknown[];
  queryFn: () => Promise<T>;
  enabled: boolean;
  staleTime?: number;
}

/**
 * Build the TanStack query options for an Emporix read.
 *
 * Deliberately free of any `@angular/core` import. Everything reactive arrives
 * as a plain value in `ctx`, so the auth resolution, the cache key and the
 * `enabled` gate — the parts most likely to be wrong — are testable with a
 * function call and no DI container, component or scheduler.
 *
 * The React equivalent (`useEmporixQuery`) cannot be split this way: the Rules
 * of Hooks force its `useQuery` call into the same body as its
 * `useCustomerToken()` and `useReadSite()` reads.
 *
 * Callers MUST read their signals inside `injectQuery`'s options callback, not
 * before it — see {@link injectEmporixQuery}.
 */
export function emporixQueryOptions<T, TArgs extends readonly unknown[]>(
  input: EmporixQueryInput<T, TArgs>,
  ctx: EmporixQueryContext,
): EmporixQueryOptions<T> {
  const override = input.mode === "read-auth" ? input.authOverride : undefined;
  const readCtx: AuthContext =
    override ?? (ctx.token !== null ? auth.customer(ctx.token) : auth.anonymous());

  // In customer mode the key still distinguishes guest from customer, so a
  // guest's (never-fetched) entry cannot be served to a customer later.
  const authKind =
    input.mode === "customer" ? (ctx.token !== null ? "customer" : "anonymous") : readCtx.kind;

  // Customer mode only reaches queryFn when enabled, i.e. when the token is
  // non-null; the fallback keeps the type honest without widening the signature.
  const resolvedCtx: AuthContext =
    input.mode === "customer" ? auth.customer(ctx.token ?? "") : readCtx;

  const enabled =
    (input.enabled ?? true) && (input.mode === "customer" ? ctx.token !== null : true);

  return {
    queryKey: emporixKey(input.resource, input.args, {
      tenant: ctx.tenant,
      authKind,
      ...siteMeta(input.site, ctx.siteCode, ctx.language),
    }),
    queryFn: () => input.queryFn(resolvedCtx),
    enabled,
    // Omitted rather than set to undefined: exactOptionalPropertyTypes is on,
    // and an explicit undefined would override the ["emporix"] 30s default.
    ...(input.staleTime !== undefined ? { staleTime: input.staleTime } : {}),
  };
}
