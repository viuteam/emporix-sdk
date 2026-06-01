import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { CouponService } from "../../src/services/coupon";

describe("EmporixClient coupon wiring", () => {
  it("exposes the coupon service", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.coupons).toBeInstanceOf(CouponService);
  });
});
