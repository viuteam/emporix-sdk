import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  auth,
  type AuthContext,
  type PriceMatch,
  type PriceMatchByContextInput,
} from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useReadSite } from "./internal/use-read-site";

/**
 * Resolves prices for `input.items` via `prices.matchByContext`. Defaults to
 * the anonymous session token (context bound at anonymous-login); pass a
 * customer token for personalized pricing. The SDK does not cache prices —
 * control freshness via the query key / `enabled` (re-run before checkout).
 */
export function useMatchPrices(
  input: PriceMatchByContextInput,
  options: { enabled?: boolean; customerToken?: string | null } = {},
): UseQueryResult<PriceMatch[]> {
  const { client } = useEmporix();
  const { siteCode } = useReadSite();
  const ctx: AuthContext = options.customerToken
    ? auth.customer(options.customerToken)
    : auth.anonymous();
  return useQuery({
    queryKey: [
      "emporix",
      "match-prices",
      { tenant: client.tenant, input, anon: !options.customerToken, siteCode },
    ],
    enabled: (options.enabled ?? true) && (input.items?.length ?? 0) > 0,
    queryFn: () => client.prices.matchByContext(input, ctx),
  });
}
