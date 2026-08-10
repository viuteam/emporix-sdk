import type { PaginatedItems } from "./context";
import type { HttpClient, RequestOptions } from "./http";

/** Pagination inputs for {@link requestPage}. */
export interface PageParams {
  /** 1-based, as Emporix counts. */
  pageNumber: number;
  pageSize: number;
  /**
   * Ask Emporix for the absolute match count via the `X-Total-Count: true`
   * request header.
   *
   * Off by default and opt-in per call, not a client-wide setting: the count
   * costs the server a second query, and defaulting it on would put that cost
   * on every list every storefront issues.
   */
  totalCount?: boolean;
}

/**
 * Reads a non-negative integer header, or `undefined` when it is missing or is
 * not one. A malformed value must not reach the `hasNextPage` arithmetic —
 * `Number("lots")` is `NaN`, and every comparison against `NaN` is `false`,
 * which would silently report "last page" on every page.
 */
function intHeader(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

/**
 * Issues one page of a list endpoint and assembles {@link PaginatedItems} from
 * the body plus Emporix's pagination response headers.
 *
 * Cursors travel in opposite directions: the caller sends one as the `next` or
 * `prev` **query parameter** (so it belongs in `o.query`), and the server
 * returns the following one as the `X-Next-Cursor` **response header**. This
 * helper only ever reads them.
 */
export async function requestPage<T>(
  http: HttpClient,
  o: RequestOptions,
  page: PageParams,
): Promise<PaginatedItems<T>> {
  const { data, headers } = await http.requestWithMeta<T[]>(
    page.totalCount === true
      ? { ...o, headers: { ...(o.headers ?? {}), "X-Total-Count": "true" } }
      : o,
  );

  // A 204 or empty body parses to `undefined`. Facades used to index straight
  // into the result and would throw; an empty page is the honest answer.
  const items = data ?? [];
  const totalCount = intHeader(headers, "X-Total-Count");
  const nextCursor = headers.get("X-Next-Cursor") ?? undefined;
  const prevCursor = headers.get("X-Prev-Cursor") ?? undefined;

  // Three tiers, most precise first. Tier 1 is ONE-DIRECTIONAL on purpose: only
  // two endpoints in the whole API emit a cursor header, so its absence says
  // nothing at all and has to fall through to the other two.
  const hasNextPage =
    nextCursor !== undefined
      ? true
      : totalCount !== undefined
        ? page.pageNumber * page.pageSize < totalCount
        : items.length === page.pageSize;

  // Spread conditionally — `exactOptionalPropertyTypes` rejects an explicit
  // `undefined` for an optional property.
  return {
    items,
    pageNumber: page.pageNumber,
    pageSize: page.pageSize,
    hasNextPage,
    ...(totalCount === undefined ? {} : { totalCount }),
    ...(nextCursor === undefined ? {} : { nextCursor }),
    ...(prevCursor === undefined ? {} : { prevCursor }),
  };
}
