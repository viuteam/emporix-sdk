import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { Site } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useReadAuth, type QueryOpts } from "./internal/use-read-auth";

const SITES_STALE_TIME = 10 * 60_000; // 10 minutes — sites change admin-side only.

/** Lists active sites for the tenant. */
export function useSites(options: QueryOpts = {}): UseQueryResult<Site[]> {
  const { client } = useEmporix();
  const { ctx } = useReadAuth(options.auth);
  return useQuery({
    queryKey: ["emporix", "sites", { tenant: client.tenant, authKind: ctx.kind }],
    queryFn: () => client.sites.list(ctx),
    staleTime: SITES_STALE_TIME,
  });
}

/** Convenience: the tenant's default site (the one flagged `default: true`). */
export function useDefaultSite(options: QueryOpts = {}): UseQueryResult<Site> {
  const { client } = useEmporix();
  const { ctx } = useReadAuth(options.auth);
  return useQuery({
    queryKey: ["emporix", "site-default", { tenant: client.tenant, authKind: ctx.kind }],
    queryFn: () => client.sites.current(ctx),
    staleTime: SITES_STALE_TIME,
  });
}
