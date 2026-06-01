import { describe, it, expectTypeOf } from "vitest";
import type {
  Coupon,
  CouponInput,
  Redemption,
  RedemptionInput,
  RedemptionCreated,
  ReferralCoupon,
} from "../../src/services/coupon-types";

describe("coupon types", () => {
  it("Coupon carries a code", () => {
    const c = { code: "SUMMER" } as Coupon;
    expectTypeOf(c.code).toEqualTypeOf<string | undefined>();
  });

  it("CouponInput is usable as a create body", () => {
    expectTypeOf<CouponInput>().not.toBeNever();
    const i: CouponInput = { name: "Summer sale", code: "SUMMER" };
    expectTypeOf(i.name).toEqualTypeOf<string>();
  });

  it("RedemptionInput requires orderTotal and discount, allows orderCode", () => {
    const r: RedemptionInput = {
      orderCode: "O1",
      orderTotal: { amount: 100, currency: "EUR" },
      discount: { amount: 10, currency: "EUR" },
    };
    expectTypeOf(r.orderCode).toEqualTypeOf<string | undefined>();
  });

  it("Redemption / RedemptionCreated / ReferralCoupon are usable", () => {
    expectTypeOf<Redemption>().not.toBeNever();
    const created: RedemptionCreated = { id: "r1" };
    expectTypeOf(created.id).toEqualTypeOf<string | undefined>();
    expectTypeOf<ReferralCoupon>().not.toBeNever();
  });
});
