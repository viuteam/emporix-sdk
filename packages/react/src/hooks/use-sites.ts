import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { Site } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useReadAuth, type QueryOpts } from "./internal/use-read-auth";
import { emporixKey } from "./internal/query-keys";
import { useSiteContext } from "./use-site-context";

const SITES_STALE_TIME = 10 * 60_000; // 10 minutes — sites change admin-side only.

/** Lists active sites for the tenant. */
export function useSites(options: QueryOpts = {}): UseQueryResult<Site[]> {
  const { client } = useEmporix();
  const { ctx } = useReadAuth(options.auth);
  return useQuery({
    queryKey: emporixKey("sites", [], { tenant: client.tenant, authKind: ctx.kind }),
    queryFn: () => client.sites.list(ctx),
    staleTime: SITES_STALE_TIME,
  });
}

/** Convenience: the tenant's default site (the one flagged `default: true`). */
export function useDefaultSite(options: QueryOpts = {}): UseQueryResult<Site> {
  const { client } = useEmporix();
  const { ctx } = useReadAuth(options.auth);
  return useQuery({
    queryKey: emporixKey("site-default", [], { tenant: client.tenant, authKind: ctx.kind }),
    queryFn: () => client.sites.current(ctx),
    staleTime: SITES_STALE_TIME,
  });
}

/**
 * The active site — the one whose `code` matches `useSiteContext().siteCode`.
 * Returns `undefined` while the sites list is loading, when no site is active,
 * or when the active code has no match. Derives from the shared `useSites()`
 * query (React-Query dedupes — no extra request).
 */
export function useActiveSite(options: QueryOpts = {}): Site | undefined {
  const { siteCode } = useSiteContext();
  const { data: sites } = useSites(options);
  return siteCode ? sites?.find((s) => s.code === siteCode) : undefined;
}
