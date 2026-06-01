import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { SequentialIdService } from "../../src/services/sequential-id";

describe("EmporixClient sequential id wiring", () => {
  it("exposes the sequentialIds service", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.sequentialIds).toBeInstanceOf(SequentialIdService);
  });
});
