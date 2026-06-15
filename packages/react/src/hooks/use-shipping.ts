import { type UseQueryResult } from "@tanstack/react-query";
import { type ZoneList } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useReadSite } from "./internal/use-read-site";
import { useEmporixQuery } from "./internal/use-emporix-query";

const SHIPPING_ZONES_STALE_TIME = 10 * 60_000; // 10 minutes — admin-configured.

/**
 * Lists shipping zones with their active methods + fees for the current session
 * (customer or guest). One call: `expand=methods,fees` + `activeMethods=true`.
 * The site defaults to the provider's active `siteCode` and is carried in the
 * query-key args (so `site: "none"` keeps it out of the key's site meta).
 */
export function useShippingZones(
  options: { site?: string; enabled?: boolean } = {},
): UseQueryResult<ZoneList> {
  const { client } = useEmporix();
  const { siteCode } = useReadSite();
  const site = options.site ?? siteCode;
  return useEmporixQuery({
    mode: "read-auth",
    site: "none",
    resource: "shipping-zones",
    args: [site],
    enabled: (options.enabled ?? true) && site !== null,
    queryFn: (ctx) =>
      client.shipping.listZones(site as string, { expand: "methods,fees", activeMethods: "true" }, ctx),
    staleTime: SHIPPING_ZONES_STALE_TIME,
  });
}
