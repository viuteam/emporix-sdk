import { describe, expect, it } from "vitest";
import * as pkg from "../src/index";

/**
 * The query factory is a supported API, not an internal.
 *
 * It is what a consumer wraps the SDK's back-office operations with — roughly
 * three quarters of ~490 operations have no hook here, because a storefront
 * token cannot call them and a Managed Dashboard token can. Without this export
 * the only option is a hand-rolled `useQuery`, whose cache key then sits outside
 * `["emporix"]` and misses both the scoped invalidation and the provider's query
 * defaults.
 *
 * Angular's `injectEmporixQuery` has been public since its first release. This
 * test is what stops the two from drifting apart again.
 */
describe("public query factory", () => {
  it("exports useEmporixQuery from the package root", () => {
    expect(typeof pkg.useEmporixQuery).toBe("function");
  });

  it("exports useEmporixInfinite from the package root", () => {
    expect(typeof pkg.useEmporixInfinite).toBe("function");
  });

  /**
   * The factory is useless without a client, and `useEmporix` is how a consumer
   * gets one. Both have to be reachable from the same import.
   */
  it("exports useEmporix alongside it", () => {
    expect(typeof pkg.useEmporix).toBe("function");
  });
});
