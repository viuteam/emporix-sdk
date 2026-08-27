import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { auth, type AuthContext } from "@viu/emporix-sdk";
import { useEmporix } from "../../provider";
import { useReadSite } from "./use-read-site";
import { useCustomerToken } from "./use-storage-snapshot";
import { emporixKey, siteMeta, type SiteFields } from "./query-keys";

interface BaseQuery<T, TArgs extends readonly unknown[]> {
  resource: string;
  args: TArgs;
  site: SiteFields;
  /** Receives the resolved auth context. */
  queryFn: (ctx: AuthContext) => Promise<T>;
  staleTime?: number;
  /** ANDed with the internal gates (customer-gated requires a token). */
  enabled?: boolean;
}

/** Anonymous-or-customer read (customer if a token is stored, else anonymous). */
interface ReadAuthQuery<T, TArgs extends readonly unknown[]> extends BaseQuery<T, TArgs> {
  mode: "read-auth";
  /** Per-call override (the hook's `QueryOpts.auth`). */
  authOverride?: AuthContext;
}

/** Customer-only read: keyed customer/anonymous, enabled only with a token. */
interface CustomerGatedQuery<T, TArgs extends readonly unknown[]> extends BaseQuery<T, TArgs> {
  mode: "customer";
}

/**
 * Configuration for {@link useEmporixQuery}.
 *
 * `mode: "read-auth"` sends the customer token when one is stored and an
 * anonymous one otherwise, and accepts a per-call `authOverride`.
 * `mode: "customer"` keys the same way but stays disabled until a token exists,
 * so a logged-out caller issues no request instead of a 401.
 */
export type EmporixQueryConfig<T, TArgs extends readonly unknown[] = readonly unknown[]> =
  | ReadAuthQuery<T, TArgs>
  | CustomerGatedQuery<T, TArgs>;

/**
 * The read-hook factory behind every read hook in this package.
 *
 * Encapsulates the auth + site + key + default-options scaffolding: it resolves
 * the auth context, builds the `["emporix", …]` cache key through the shared
 * builder, gates `enabled`, and applies `staleTime`. Behaviour is identical to
 * the hand-rolled `useQuery` it replaced — same key, same gate, same staleness.
 *
 * **Public, so you can wrap the operations this package does not.** The SDK
 * exposes ~490 operations and the hooks cover about a quarter of them; the rest
 * are back-office calls a storefront token cannot make. In a Managed Dashboard
 * module the host's token *can*, so wrapping one is a five-line hook — and going
 * through this factory is what keeps its cache key identical to every other
 * read's, which hand-rolling `useQuery` does not.
 *
 * @example
 * ```ts
 * // An admin read, in a Managed Dashboard module.
 * function useBrands(params: { pageNumber?: number } = {}) {
 *   const { client } = useEmporix();
 *   return useEmporixQuery({
 *     mode: "customer", // the host's token, which has the scopes
 *     site: "none", // brands are tenant-scoped, not site-scoped
 *     resource: "brands",
 *     args: [params],
 *     queryFn: (ctx) => client.brands.list(params, ctx),
 *   });
 * }
 * ```
 *
 * Calls a fixed, unconditional set of hooks every render (Rules of Hooks);
 * a single `useCustomerToken()` read serves both modes.
 */
export function useEmporixQuery<T, TArgs extends readonly unknown[]>(
  cfg: ReadAuthQuery<T, TArgs> | CustomerGatedQuery<T, TArgs>,
): UseQueryResult<T> {
  const { client } = useEmporix();
  const token = useCustomerToken();
  const { siteCode, language } = useReadSite();

  const authOverride = cfg.mode === "read-auth" ? cfg.authOverride : undefined;
  const readCtx: AuthContext =
    authOverride ?? (token ? auth.customer(token) : auth.anonymous());

  const authKind =
    cfg.mode === "customer" ? (token ? "customer" : "anonymous") : readCtx.kind;
  // Customer mode only reaches queryFn when enabled (token present).
  const resolvedCtx: AuthContext =
    cfg.mode === "customer" ? auth.customer(token as string) : readCtx;

  const meta = siteMeta(cfg.site, siteCode, language);

  const enabled =
    (cfg.enabled ?? true) && (cfg.mode === "customer" ? token !== null : true);

  return useQuery({
    queryKey: emporixKey(cfg.resource, cfg.args, {
      tenant: client.tenant,
      authKind,
      ...meta,
    }),
    queryFn: () => cfg.queryFn(resolvedCtx),
    enabled,
    ...(cfg.staleTime !== undefined ? { staleTime: cfg.staleTime } : {}),
  });
}
