import { type UseQueryResult } from "@tanstack/react-query";
import { auth, type AuthContext, type Availability } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useEmporixQuery } from "./internal/use-emporix-query";

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
 *
 * Keying follows `useAvailability`: `siteCode` is an explicit argument so it goes
 * in the positional args with `site: "none"`, and `authOverride` is always
 * supplied so a stored token never silently personalizes the read.
 */
export function useAvailabilities(
  productIds: string[],
  siteCode: string,
  options: UseAvailabilitiesOptions = {},
): UseQueryResult<Availability[]> {
  const { client } = useEmporix();
  const defaultAvailableOnNotFound = options.defaultAvailableOnNotFound ?? false;
  const ctx: AuthContext = options.customerToken
    ? auth.customer(options.customerToken)
    : auth.anonymous();
  return useEmporixQuery({
    mode: "read-auth",
    site: "none",
    resource: "availabilities",
    args: [productIds, siteCode, defaultAvailableOnNotFound],
    authOverride: ctx,
    enabled: (options.enabled ?? true) && productIds.length > 0 && Boolean(siteCode),
    queryFn: (resolved) =>
      client.availability.getMany(productIds, siteCode, resolved, { defaultAvailableOnNotFound }),
    staleTime: AVAILABILITY_STALE_TIME,
  });
}
