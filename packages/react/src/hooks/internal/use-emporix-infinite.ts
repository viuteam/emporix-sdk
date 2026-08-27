import {
  useInfiniteQuery,
  type UseInfiniteQueryResult,
} from "@tanstack/react-query";
import type { PaginatedItems } from "@viu/emporix-sdk";

/**
 * The paginated `useInfiniteQuery` wrapper behind every infinite read hook.
 *
 * Centralizes the `initialPageParam: 1` + `getNextPageParam` cursor logic
 * shared by every paginated infinite hook (products, categories, segments).
 * Termination is `hasNextPage === false` on the last page — never a trailing
 * empty fetch.
 *
 * **Thinner than {@link useEmporixQuery}, and knowingly so.** This one takes a
 * `queryKey` you build and resolves no auth: it predates the query factory and
 * every caller in this package already had both. Build the key with `emporixKey`
 * from `@viu/emporix-sdk` so it matches the rest of the cache, and resolve the
 * context yourself.
 *
 * @example
 * ```ts
 * const { client, storage } = useEmporix();
 * const token = storage.getCustomerToken();
 * useEmporixInfinite({
 *   queryKey: emporixKey("brands-infinite", [pageSize], {
 *     tenant: client.tenant,
 *     authKind: token !== null ? "customer" : "anonymous",
 *   }),
 *   enabled: token !== null,
 *   fetchPage: (pageNumber) =>
 *     client.brands.list({ pageNumber, pageSize }, auth.customer(token as string)),
 * });
 * ```
 */
export function useEmporixInfinite<T>(opts: {
  queryKey: readonly unknown[];
  fetchPage: (pageNumber: number) => Promise<PaginatedItems<T>>;
  enabled?: boolean;
  staleTime?: number;
}): UseInfiniteQueryResult<{ pages: PaginatedItems<T>[]; pageParams: number[] }> {
  return useInfiniteQuery({
    queryKey: opts.queryKey as unknown[],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => opts.fetchPage(pageParam as number),
    getNextPageParam: (last: PaginatedItems<T>) =>
      last.hasNextPage ? last.pageNumber + 1 : undefined,
    ...(opts.enabled !== undefined ? { enabled: opts.enabled } : {}),
    ...(opts.staleTime !== undefined ? { staleTime: opts.staleTime } : {}),
  });
}
