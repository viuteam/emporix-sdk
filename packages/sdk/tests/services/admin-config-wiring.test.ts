import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { IndexingService } from "../../src/services/indexing";
import { UnitHandlingService } from "../../src/services/unit-handling";

describe("EmporixClient admin-config wiring", () => {
  it("exposes indexing and units", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.indexing).toBeInstanceOf(IndexingService);
    expect(sdk.units).toBeInstanceOf(UnitHandlingService);
  });

  /**
   * The SEPA Export service reached End of Life on 2026-08-24 and Emporix removed
   * its endpoints. This asserts the property is gone rather than left behind as a
   * facade that can only answer 404.
   */
  it("no longer exposes sepaExport", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect("sepaExport" in sdk).toBe(false);
  });
});
