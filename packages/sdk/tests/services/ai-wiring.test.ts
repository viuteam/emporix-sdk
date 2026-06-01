import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { AiService } from "../../src/services/ai";

describe("EmporixClient ai wiring", () => {
  it("exposes the ai service", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.ai).toBeInstanceOf(AiService);
  });
});
