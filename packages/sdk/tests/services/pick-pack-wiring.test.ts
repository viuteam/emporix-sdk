import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";

describe("EmporixClient pick-pack wiring", () => {
  /**
   * The Pick-Pack service reached End of Life and Emporix removed its endpoints
   * on 2026-09-16. This asserts the property is gone rather than left behind as a
   * facade that can only answer 404.
   */
  it("no longer exposes pickPack", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect("pickPack" in sdk).toBe(false);
  });
});
