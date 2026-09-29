/**
 * Paging, sort and field selection for a `POST …/search` endpoint. Emporix reads
 * them from the query string, not the body, so the SDK sends them there. Without
 * them a search returns only the server's first page.
 */
export interface SearchPaging {
  pageNumber?: number;
  pageSize?: number;
  /** Properties to sort by, in Emporix sort syntax. */
  sort?: string;
  /** Comma-separated fields to return. */
  fields?: string;
}

/** The {@link SearchPaging} keys, for {@link splitQuery}. */
export const SEARCH_PAGING = ["pageNumber", "pageSize", "sort", "fields"] as const;

/**
 * Splits a request input: the named keys go to the query string, everything
 * else stays in the body. A `POST …/search` declares its paging, sort and similar
 * parameters in the query and ignores them in the body — sent there, the search
 * silently returns the first page.
 */
export function splitQuery(
  input: object,
  queryKeys: readonly string[],
): { body: Record<string, unknown>; query: Record<string, string | number | boolean | undefined> } {
  const body: Record<string, unknown> = {};
  const query: Record<string, string | number | boolean | undefined> = {};
  for (const [key, value] of Object.entries(input)) {
    if (queryKeys.includes(key)) query[key] = value as string | number | boolean | undefined;
    else body[key] = value;
  }
  return { body, query };
}
