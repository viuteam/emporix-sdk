import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { auth, type AuthContext, type Availability } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";

const AVAILABILITY_STALE_TIME = 30_000; // 30s — stock changes, but not per render.

export interface UseAvailabilityOptions {
  enabled?: boolean;
  customerToken?: string | null;
  defaultAvailableOnNotFound?: boolean;
}

/**
 * Reads availability for one product on one site via `availability.get`.
 * Defaults to the anonymous token; pass `customerToken` for a customer context.
 */
export function useAvailability(
  productId: string,
  siteCode: string,
  options: UseAvailabilityOptions = {},
): UseQueryResult<Availability> {
  const { client } = useEmporix();
  const ctx: AuthContext = options.customerToken
    ? auth.customer(options.customerToken)
    : auth.anonymous();
  return useQuery({
    queryKey: [
      "emporix",
      "availability",
      {
        tenant: client.tenant,
        productId,
        siteCode,
        anon: !options.customerToken,
        defaultAvailableOnNotFound: options.defaultAvailableOnNotFound ?? false,
      },
    ],
    enabled: (options.enabled ?? true) && Boolean(productId) && Boolean(siteCode),
    queryFn: () =>
      client.availability.get(productId, siteCode, ctx, {
        defaultAvailableOnNotFound: options.defaultAvailableOnNotFound ?? false,
      }),
    staleTime: AVAILABILITY_STALE_TIME,
  });
}
