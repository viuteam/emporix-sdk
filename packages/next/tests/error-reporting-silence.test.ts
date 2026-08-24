import { describe, it, expect, afterEach, vi } from "vitest";
import {
  setEmporixErrorReporter,
  __resetEmporixErrorReporter,
  type EmporixErrorEvent,
} from "../src/error-reporting";
import { emporixTagsForUrl } from "../src/tags";
import { createProxyFetch } from "../src/public-client";
import { createEmporixPublicRoute } from "../src/public-route";

/**
 * Five `catch` sites in this package are deliberately silent, and the reasoning
 * per site is in
 * `docs/superpowers/specs/2026-08-24-next-error-reporting-design.md`. This file
 * is the guard: a later «report every catch» pass would fire on cookie-secret
 * rotation and on attacker-controlled input, and train the reader to ignore the
 * channel.
 *
 * `cookie-crypto.ts`'s per-key retry and `request-scope.ts`'s rethrow are the
 * other two. Neither is reachable without reaching into internals, and both are
 * silent by construction — the first throws when every key fails, the second
 * rethrows — so they are covered by nothing in this feature touching them.
 */
afterEach(() => {
  __resetEmporixErrorReporter();
  vi.unstubAllGlobals();
});

function collect(): EmporixErrorEvent[] {
  const seen: EmporixErrorEvent[] = [];
  setEmporixErrorReporter((e) => seen.push(e));
  return seen;
}

describe("deliberately silent paths stay silent", () => {
  it("a malformed URL in the tag allowlist reports nothing", () => {
    const seen = collect();
    // Attacker-controlled input reaches this through the public proxy. Reporting
    // it would be a log-flooding lever.
    expect(emporixTagsForUrl("not a url", "acme")).toEqual([]);
    expect(seen).toEqual([]);
  });

  it("a relative URL in the proxy fetch reports nothing", async () => {
    const seen = collect();
    const passthrough = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", passthrough);

    const f = createProxyFetch({ base: "/api/emporix" });
    await f("/local/thing");

    // A relative URL is a routing branch, not a failure.
    expect(passthrough).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([]);
  });

  it("a cross-origin request rejected by the public route reports nothing", async () => {
    const seen = collect();
    const route = createEmporixPublicRoute({ tenant: "acme" });
    const res = await route(
      new Request("https://app.example/api/emporix/product/acme/products", {
        headers: { "sec-fetch-site": "cross-site" },
      }),
      { params: Promise.resolve({ path: ["product", "acme", "products"] }) },
    );

    // `assertSameOrigin` rejecting is the feature working, on expected traffic.
    expect(res.status).toBe(403);
    expect(seen).toEqual([]);
  });
});
