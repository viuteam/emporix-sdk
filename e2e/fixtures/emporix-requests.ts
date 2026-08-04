const EMPORIX_HOSTNAME = "api.emporix.io";

/**
 * True when a request URL's **host** is Emporix.
 *
 * Both request-observing specs used `url.includes("api.emporix.io")`, which
 * CodeQL flagged as `js/incomplete-url-substring-sanitization` (high). It was
 * right about the pattern even though nothing hostile reaches these tests:
 * `https://elsewhere.example/?ref=api.emporix.io` matches the substring and
 * `https://api.emporix.io.evil.test/` matches it too. In a spec that asserts an
 * exact set of calls, a filter that admits other hosts is a wrong assertion
 * waiting to happen, not just a lint finding.
 *
 * Comparing the parsed `hostname` costs one `new URL` — which both call sites
 * needed anyway for the pathname.
 */
export function isEmporixRequest(url: string): boolean {
  try {
    return new URL(url).hostname === EMPORIX_HOSTNAME;
  } catch {
    // A request URL Playwright reports but WHATWG cannot parse is not Emporix's.
    return false;
  }
}
