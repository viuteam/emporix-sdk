import { describe, expect, it } from "vitest";
import { isTopLevelNavigation } from "../src/navigation";

/** A minimal request stub: the predicate only reads `headers.get`. */
function req(headers: Record<string, string>): { headers: { get(n: string): string | null } } {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { headers: { get: (n) => lower.get(n.toLowerCase()) ?? null } };
}

describe("isTopLevelNavigation", () => {
  it("recognises a document navigation", () => {
    // Measured against a real page load in Chrome: navigate + document.
    expect(isTopLevelNavigation(req({ "Sec-Fetch-Mode": "navigate" }))).toBe(true);
  });

  it("treats a fetch-based request as NOT a navigation", () => {
    // A prefetch and a client-side navigation are both `cors` — middleware cannot
    // tell them apart, and for this purpose it does not need to.
    expect(isTopLevelNavigation(req({ "Sec-Fetch-Mode": "cors" }))).toBe(false);
  });

  it("treats a same-origin fetch as not a navigation", () => {
    expect(isTopLevelNavigation(req({ "Sec-Fetch-Mode": "same-origin" }))).toBe(false);
  });

  it("treats a missing header as a navigation", () => {
    // Old clients, curl and bots send none — silently denying them state would be
    // the worse choice. A prefetch always comes from a browser that sets it.
    expect(isTopLevelNavigation(req({}))).toBe(true);
  });

  it("treats an empty header as a navigation", () => {
    expect(isTopLevelNavigation(req({ "Sec-Fetch-Mode": "" }))).toBe(true);
  });

  it("matches the value exactly rather than by substring", () => {
    // `no-cors` contains no "navigate", but it must not slip through either if
    // somebody later rewrites this with `includes`.
    expect(isTopLevelNavigation(req({ "Sec-Fetch-Mode": "no-cors" }))).toBe(false);
    expect(isTopLevelNavigation(req({ "Sec-Fetch-Mode": "navigate-ish" }))).toBe(false);
  });
});
