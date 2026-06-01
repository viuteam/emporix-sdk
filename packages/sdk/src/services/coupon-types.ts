/**
 * Public types for the Coupon Service — stable names aliased over the generated
 * `coupon` types (single source of truth; faithful required/optional flags).
 */
import type {
  CouponWithIdAndStatus,
  Coupons,
  CouponCreation,
  BaseCoupon,
  RedemptionCreation,
  ResourceLocation,
} from "../generated/coupon";

export type {
  /** A coupon redemption (read shape). */
  Redemption,
  /** A customer's referral coupon. */
  ReferralCoupon,
} from "../generated/coupon";

/** A coupon (read shape — includes the read-only `code` and `status`). */
export type Coupon = CouponWithIdAndStatus;
/** Response of `listCoupons` — a plain array of coupons. */
export type CouponList = Coupons;
/** Create body (`POST /coupons`). `name` is required; `code` is auto-generated when omitted. */
export type CouponInput = CouponCreation;
/** Update / patch body (`PUT` / `PATCH /coupons/{code}`). */
export type CouponUpdate = BaseCoupon;
/**
 * Redemption request body (`validation` / `redemptions`). Requires `orderTotal`
 * and `discount`; `customerNumber` is honored only with the
 * `coupon.coupon_redeem_on_behalf` scope.
 */
export type RedemptionInput = RedemptionCreation;
/** `POST /redemptions` 201 response — the created redemption's `{ id?, yrn? }`. */
export type RedemptionCreated = ResourceLocation;
/** `POST /coupons` 201 response — the created coupon's `{ id?, yrn? }`. */
export type CouponCreated = ResourceLocation;
