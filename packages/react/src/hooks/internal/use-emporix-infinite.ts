import {
  useInfiniteQuery,
  type UseInfiniteQueryResult,
} from "@tanstack/react-query";
import type { PaginatedItems } from "@viu/emporix-sdk";

/**
 * Internal: standard Emporix paginated `useInfiniteQuery` wrapper.
 *
 * Centralizes the `initialPageParam: 1` + `getNextPageParam` cursor logic
 * shared by every paginated infinite hook (products, categories, segments).
 * Termination is `hasNextPage === false` on the last page — never a trailing
 * empty fetch.
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
