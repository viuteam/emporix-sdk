import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  auth,
  type AuthContext,
  type PriceMatch,
  type PriceMatchByContextInput,
} from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useReadSite } from "./internal/use-read-site";

const PRICES_STALE_TIME = 60_000; // 1 minute — prices change with promotions.

/**
 * Like {@link useMatchPrices} but chunks large `items` arrays via
 * `prices.matchByContextChunked` (default 50 items per request, 4 in flight).
 * Result order is not guaranteed — match by `priceId` / `itemRef.id`.
 */
export function useMatchPricesChunked(
  input: PriceMatchByContextInput,
  options: {
    enabled?: boolean;
    customerToken?: string | null;
    chunkSize?: number;
    concurrency?: number;
  } = {},
): UseQueryResult<PriceMatch[]> {
  const { client } = useEmporix();
  const { siteCode } = useReadSite();
  const ctx: AuthContext = options.customerToken
    ? auth.customer(options.customerToken)
    : auth.anonymous();
  return useQuery({
    queryKey: [
      "emporix",
      "match-prices-chunked",
      {
        tenant: client.tenant,
        input,
        anon: !options.customerToken,
        siteCode,
        chunkSize: options.chunkSize,
        concurrency: options.concurrency,
      },
    ],
    enabled: (options.enabled ?? true) && (input.items?.length ?? 0) > 0,
    queryFn: () =>
      client.prices.matchByContextChunked(
        input,
        {
          ...(options.chunkSize !== undefined ? { chunkSize: options.chunkSize } : {}),
          ...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
        },
        ctx,
      ),
    staleTime: PRICES_STALE_TIME,
  });
}
