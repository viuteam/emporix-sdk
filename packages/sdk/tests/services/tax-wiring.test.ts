import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { TaxService } from "../../src/services/tax";

describe("EmporixClient tax wiring", () => {
  it("exposes the tax service", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.taxes).toBeInstanceOf(TaxService);
  });
});
