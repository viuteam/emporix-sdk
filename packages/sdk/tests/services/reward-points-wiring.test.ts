import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { RewardPointsService } from "../../src/services/reward-points";

describe("EmporixClient reward points wiring", () => {
  it("exposes the reward points service", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.rewardPoints).toBeInstanceOf(RewardPointsService);
  });
});
