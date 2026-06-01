import { describe, it, expectTypeOf } from "vitest";
import type {
  PointsSummary,
  RedeemOption,
  RedeemOptionList,
  RedeemMyPointsInput,
  RedeemCouponResult,
} from "../../src/services/reward-points-types";

describe("reward points types", () => {
  it("RedeemMyPointsInput requires a redeemOptionId", () => {
    const i: RedeemMyPointsInput = { redeemOptionId: "opt-1" };
    expectTypeOf(i.redeemOptionId).toEqualTypeOf<string>();
  });

  it("RedeemCouponResult exposes the coupon code", () => {
    const r = { code: "WELCOME10" } as RedeemCouponResult;
    expectTypeOf(r.code).toEqualTypeOf<string | undefined>();
  });

  it("summary, redeem option and list are usable", () => {
    expectTypeOf<PointsSummary>().not.toBeNever();
    expectTypeOf<RedeemOption>().not.toBeNever();
    expectTypeOf<RedeemOptionList>().not.toBeNever();
  });
});
