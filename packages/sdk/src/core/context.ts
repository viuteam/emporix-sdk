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

/**
 * A cursor-paged collection — `pageNumber`/`pageSize` indexing with a
 * `hasNextPage` signal driven by the source page being full. Used by all
 * paginated services and hooks across the SDK.
 */
export interface PaginatedItems<T> {
  items: T[];
  pageNumber: number;
  pageSize: number;
  hasNextPage: boolean;
  /**
   * Absolute number of matches, when the caller asked for it and the endpoint
   * answered. Opt-in per call (`totalCount: true`), because Emporix computes it
   * with a second query — see `core/paged.ts`.
   *
   * Always `undefined` in cursor mode: the server ignores the request header
   * and omits the response header there.
   */
  totalCount?: number;
  /**
   * Opaque cursor for the next page, on the endpoints that offer one (today:
   * the schema service's custom instances). Pass it back as the `next` query
   * parameter. Absence means "this endpoint said nothing", NOT "last page".
   */
  nextCursor?: string;
  /** Opaque cursor for the previous page. Same caveat as {@link nextCursor}. */
  prevCursor?: string;
}

/** Default `AuthContext` applied by a service when the caller passes none. */
export type DefaultAuth = AuthContext | undefined;

/**
 * Async-iterates every item across pages of a `PaginatedItems<T>` source.
 * Stops when the source reports `hasNextPage: false`.
 *
 * @param fetchPage - given a 1-based page number, returns the page.
 * @param start - first page to fetch (default `1`).
 */
export async function* iterateAll<T>(
  fetchPage: (pageNumber: number) => Promise<PaginatedItems<T>>,
  start = 1,
): AsyncIterable<T> {
  let p = start;
  for (;;) {
    const page = await fetchPage(p);
    for (const it of page.items) yield it;
    if (!page.hasNextPage) return;
    p += 1;
  }
}

