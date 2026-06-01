import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { ShippingService } from "../../src/services/shipping";

describe("EmporixClient shipping wiring", () => {
  it("exposes the shipping service", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.shipping).toBeInstanceOf(ShippingService);
  });
});
