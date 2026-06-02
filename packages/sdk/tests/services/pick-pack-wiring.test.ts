import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { PickPackService } from "../../src/services/pick-pack";

describe("EmporixClient pick-pack wiring", () => {
  it("exposes the pick-pack service", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.pickPack).toBeInstanceOf(PickPackService);
  });
});
