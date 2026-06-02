import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { CatalogService } from "../../src/services/catalog";
import { VendorService } from "../../src/services/vendor";

describe("EmporixClient catalog/vendor wiring", () => {
  it("exposes catalogs and vendors", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.catalogs).toBeInstanceOf(CatalogService);
    expect(sdk.vendors).toBeInstanceOf(VendorService);
  });
});
