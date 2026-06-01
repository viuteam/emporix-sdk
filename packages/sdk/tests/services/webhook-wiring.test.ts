import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { WebhookService } from "../../src/services/webhook";

describe("EmporixClient webhook wiring", () => {
  it("exposes the webhooks service", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.webhooks).toBeInstanceOf(WebhookService);
  });
});
