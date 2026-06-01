import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { FeeService } from "../../src/services/fee";

describe("EmporixClient fee wiring", () => {
  it("exposes the fees service", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.fees).toBeInstanceOf(FeeService);
  });
});
