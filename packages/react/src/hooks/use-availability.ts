import { type UseQueryResult } from "@tanstack/react-query";
import { auth, type AuthContext, type Availability } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useEmporixQuery } from "./internal/use-emporix-query";

const AVAILABILITY_STALE_TIME = 30_000; // 30s — stock changes, but not per render.

export interface UseAvailabilityOptions {
  enabled?: boolean;
  customerToken?: string | null;
  defaultAvailableOnNotFound?: boolean;
}

/**
 * Reads availability for one product on one site via `availability.get`.
 * Defaults to the anonymous token; pass `customerToken` for a customer context.
 *
 * `siteCode` is an explicit argument rather than the ambient site, so it lives in
 * the key's positional args and `site` is `"none"`. `authOverride` is always
 * supplied — without it, `read-auth` would fall back to the *stored* token and a
 * logged-in shopper would start receiving personalized availability.
 */
export function useAvailability(
  productId: string,
  siteCode: string,
  options: UseAvailabilityOptions = {},
): UseQueryResult<Availability> {
  const { client } = useEmporix();
  const defaultAvailableOnNotFound = options.defaultAvailableOnNotFound ?? false;
  const ctx: AuthContext = options.customerToken
    ? auth.customer(options.customerToken)
    : auth.anonymous();
  return useEmporixQuery({
    mode: "read-auth",
    site: "none",
    resource: "availability",
    args: [productId, siteCode, defaultAvailableOnNotFound],
    authOverride: ctx,
    enabled: (options.enabled ?? true) && Boolean(productId) && Boolean(siteCode),
    queryFn: (resolved) =>
      client.availability.get(productId, siteCode, resolved, { defaultAvailableOnNotFound }),
    staleTime: AVAILABILITY_STALE_TIME,
  });
}
