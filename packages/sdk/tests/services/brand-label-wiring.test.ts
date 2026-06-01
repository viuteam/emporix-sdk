import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { BrandService } from "../../src/services/brand";
import { LabelService } from "../../src/services/label";

describe("EmporixClient brand/label wiring", () => {
  it("exposes the brand and label services", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.brands).toBeInstanceOf(BrandService);
    expect(sdk.labels).toBeInstanceOf(LabelService);
  });
});
