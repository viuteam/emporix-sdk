import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { type ZoneList } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useReadAuth } from "./internal/use-read-auth";
import { useReadSite } from "./internal/use-read-site";
import { emporixKey } from "./internal/query-keys";

const SHIPPING_ZONES_STALE_TIME = 10 * 60_000; // 10 minutes — admin-configured.

/**
 * Lists shipping zones with their active methods + fees for the current session
 * (customer or guest). One call: `expand=methods,fees` + `activeMethods=true`.
 * The site defaults to the provider's active `siteCode`.
 */
export function useShippingZones(
  options: { site?: string; enabled?: boolean } = {},
): UseQueryResult<ZoneList> {
  const { client } = useEmporix();
  const { ctx } = useReadAuth();
  const { siteCode } = useReadSite();
  const site = options.site ?? siteCode;
  return useQuery({
    queryKey: emporixKey("shipping-zones", [site], { tenant: client.tenant, authKind: ctx.kind }),
    enabled: (options.enabled ?? true) && site !== null,
    queryFn: () => {
      if (site === null) throw new Error("useShippingZones requires a site code");
      return client.shipping.listZones(site, { expand: "methods,fees", activeMethods: "true" }, ctx);
    },
    staleTime: SHIPPING_ZONES_STALE_TIME,
  });
}
