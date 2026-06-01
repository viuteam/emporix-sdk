import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { SchemaService } from "../../src/services/schema";

describe("EmporixClient schema wiring", () => {
  it("exposes the schemas service", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.schemas).toBeInstanceOf(SchemaService);
  });
});
