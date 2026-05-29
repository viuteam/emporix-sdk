import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { auth, type AuthContext, type Availability } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";

const AVAILABILITY_STALE_TIME = 30_000; // 30s — stock changes, but not per render.

export interface UseAvailabilitiesOptions {
  enabled?: boolean;
  customerToken?: string | null;
  defaultAvailableOnNotFound?: boolean;
}

/**
 * Reads availability for many products on one site via `availability.getMany`
 * (a single batch request). Returns records in input order; missing products
 * are `{ available: false }` (or `{ available: true }` with
 * `defaultAvailableOnNotFound`).
 */
export function useAvailabilities(
  productIds: string[],
  siteCode: string,
  options: UseAvailabilitiesOptions = {},
): UseQueryResult<Availability[]> {
  const { client } = useEmporix();
  const ctx: AuthContext = options.customerToken
    ? auth.customer(options.customerToken)
    : auth.anonymous();
  return useQuery({
    queryKey: [
      "emporix",
      "availabilities",
      {
        tenant: client.tenant,
        productIds,
        siteCode,
        anon: !options.customerToken,
        defaultAvailableOnNotFound: options.defaultAvailableOnNotFound ?? false,
      },
    ],
    enabled: (options.enabled ?? true) && productIds.length > 0 && Boolean(siteCode),
    queryFn: () =>
      client.availability.getMany(productIds, siteCode, ctx, {
        defaultAvailableOnNotFound: options.defaultAvailableOnNotFound ?? false,
      }),
    staleTime: AVAILABILITY_STALE_TIME,
  });
}
