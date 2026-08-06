/**
 * What a `[[...page]]` segment means, decided in one place.
 *
 * Before this, `Math.max(1, Number(segments?.[0]) || 1)` mapped `0`, `-1`, `abc` and a
 * missing segment all onto page 1, and ignored extra segments entirely. Measured
 * 2026-08-06: nine different category URLs answered 200, four of them rendering page
 * one under a URL that is not page one, and `…/99999` answering 200 with «Nothing on
 * page 99999» while nominating itself as its own canonical.
 *
 * Three outcomes rather than a number, because the three need different HTTP answers: a
 * page renders, an alias redirects, an invalid segment 404s. A parser that returned a
 * number could not express that difference and every caller would have to re-derive it.
 *
 * Pure and free of server imports so vitest can load it — same rule as `seo.ts` and
 * `safe-next.ts`.
 */

/**
 * The largest page number this app will forward to Emporix.
 *
 * Not arbitrary caution: measured 2026-08-06, `pageNumber: 99999` answers 200 with an
 * empty list, but 1e15 and above answer `400 EmporixValidationError` — which would
 * surface as a 500. An empty page can be turned into a 404 by looking at the result; a
 * 400 cannot.
 *
 * 10'000 pages is 240'000 products in one category at the page size this app uses. No
 * URL beyond that was ever a page somebody reached.
 */
export const MAX_PAGE = 10_000;

export type PageSegment =
  /** Render this page. `page` is 1 when the segment is absent. */
  | { kind: "page"; page: number }
  /** The page-one duplicate — redirect permanently to the bare URL. */
  | { kind: "alias" }
  /** Not a document. 404. */
  | { kind: "invalid" };

export function parsePageSegment(segments: string[] | undefined): PageSegment {
  if (segments === undefined || segments.length === 0) return { kind: "page", page: 1 };
  if (segments.length > 1) return { kind: "invalid" };

  const raw = segments[0] ?? "";
  // A strict decimal without a leading zero. `Number()` would accept " 2", "1e3", "1.5"
  // and "0x2" — all of which arrived as 200s before.
  if (!/^[1-9][0-9]*$/.test(raw)) return { kind: "invalid" };

  const page = Number(raw);
  if (page > MAX_PAGE) return { kind: "invalid" };
  return page === 1 ? { kind: "alias" } : { kind: "page", page };
}
