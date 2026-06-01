import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { ReturnsService } from "../../src/services/returns";

describe("EmporixClient returns wiring", () => {
  it("exposes the returns service", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.returns).toBeInstanceOf(ReturnsService);
  });
});
