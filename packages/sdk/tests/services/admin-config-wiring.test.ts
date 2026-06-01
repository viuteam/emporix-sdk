import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { SepaExportService } from "../../src/services/sepa-export";
import { IndexingService } from "../../src/services/indexing";
import { UnitHandlingService } from "../../src/services/unit-handling";

describe("EmporixClient admin-config wiring", () => {
  it("exposes sepaExport, indexing, units", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.sepaExport).toBeInstanceOf(SepaExportService);
    expect(sdk.indexing).toBeInstanceOf(IndexingService);
    expect(sdk.units).toBeInstanceOf(UnitHandlingService);
  });
});
