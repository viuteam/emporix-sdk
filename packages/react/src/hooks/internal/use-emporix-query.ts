import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { auth, type AuthContext } from "@viu/emporix-sdk";
import { useEmporix } from "../../provider";
import { useReadSite } from "./use-read-site";
import { useCustomerToken } from "./use-storage-snapshot";
import { emporixKey } from "./query-keys";

/** Which site discriminators go into the query key's meta object. */
type SiteFields = "full" | "language" | "none";

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
 * Internal read-hook factory. Encapsulates the auth + site + key + default-
 * options scaffolding repeated across the standard read hooks. Behavior is
 * identical to the hand-rolled `useQuery` it replaces: same query key, same
 * `enabled`, same `staleTime`.
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

  const siteMeta =
    cfg.site === "full"
      ? { siteCode, language }
      : cfg.site === "language"
        ? { language }
        : {};

  const enabled =
    (cfg.enabled ?? true) && (cfg.mode === "customer" ? token !== null : true);

  return useQuery({
    queryKey: emporixKey(cfg.resource, cfg.args, {
      tenant: client.tenant,
      authKind,
      ...siteMeta,
    }),
    queryFn: () => cfg.queryFn(resolvedCtx),
    enabled,
    ...(cfg.staleTime !== undefined ? { staleTime: cfg.staleTime } : {}),
  });
}
