import type { HttpClient } from "./http";
import type { TokenProvider, AuthContext } from "./auth";
import type { Logger } from "./logger";

/** Shared dependencies every service facade receives. */
export interface ClientContext {
  tenant: string;
  http: HttpClient;
  tokenProvider: TokenProvider;
  logger: Logger;
}

/** A single page of a paginated collection. */
export interface Page<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

/**
 * A cursor-paged collection — `pageNumber`/`pageSize` indexing with a
 * `hasNextPage` signal driven by the source page being full. Distinct
 * from `Page<T>` (offset/limit/total). Used by services and hooks that
 * support "load more" pagination.
 */
export interface PaginatedItems<T> {
  items: T[];
  pageNumber: number;
  pageSize: number;
  hasNextPage: boolean;
}

/** Default `AuthContext` applied by a service when the caller passes none. */
export type DefaultAuth = AuthContext | undefined;

/**
 * Async-iterates every item across pages. `fetchPage(offset, limit)` returns a
 * {@link Page}; iteration stops on a short page or once `total` is reached.
 */
export async function* paginate<T>(
  fetchPage: (offset: number, limit: number) => Promise<Page<T>>,
  limit = 50,
): AsyncIterable<T> {
  let offset = 0;
  for (;;) {
    const page = await fetchPage(offset, limit);
    for (const item of page.items) yield item;
    offset += page.items.length;
    if (page.items.length < limit) return;
    if (Number.isFinite(page.total) && offset >= page.total) return;
    if (page.items.length === 0) return;
  }
}
