import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { Site } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useReadAuth, type QueryOpts } from "./internal/use-read-auth";

/** Lists active sites for the tenant. */
export function useSites(options: QueryOpts = {}): UseQueryResult<Site[]> {
  const { client } = useEmporix();
  const { ctx, kind } = useReadAuth(options.auth);
  return useQuery({
    queryKey: ["emporix", "sites", { tenant: client.tenant, authKind: kind }],
    queryFn: () => client.sites.list(ctx),
  });
}

/** Convenience: the tenant's default site (the one flagged `default: true`). */
export function useDefaultSite(options: QueryOpts = {}): UseQueryResult<Site> {
  const { client } = useEmporix();
  const { ctx, kind } = useReadAuth(options.auth);
  return useQuery({
    queryKey: ["emporix", "site-default", { tenant: client.tenant, authKind: kind }],
    queryFn: () => client.sites.current(ctx),
  });
}
