import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { CustomerAdminService } from "../../src/services/customer-admin";

describe("EmporixClient customer-admin wiring", () => {
  it("exposes the customer-admin service", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.customerAdmin).toBeInstanceOf(CustomerAdminService);
  });
});
