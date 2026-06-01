/**
 * Public types for the Reward Points Service — stable names aliased over the
 * generated `reward-points` types (single source of truth). Structural only for
 * the inlined public-redeem body.
 *
 * Note: point *balances* (`getCustomerPoints` / `getMyPoints`) are returned as a
 * bare `number` by the upstream API, so they have no dedicated type here.
 */
import type {
  CustomerSummaryBatchOut,
  PointsSummaryOut,
  NewCustomerIn,
  RedeemOptions,
  RedeemCouponOut,
} from "../generated/reward-points";

export type {
  /** A single add-points entry / request body. */
  AddedPoints,
  /** A single redeem-points entry / request body. */
  RedeemedPoints,
  /** A redeem option (`{ id?, type?, name?, points?, coupon?, … }`). */
  RedeemOption,
} from "../generated/reward-points";

/** Batch summary across all customers (`GET /summaryBatch`) — an array of summaries. */
export type CustomerSummaryBatch = CustomerSummaryBatchOut;
/** Points summary for one customer / the signed-in customer. */
export type PointsSummary = PointsSummaryOut;
/** Create-entry body (`POST /customer/{id}`). */
export type NewPointsEntry = NewCustomerIn;
/** List of redeem options (`GET`/`POST /{tenant}/redeemOptions`). */
export type RedeemOptionList = RedeemOptions;
/** Result of redeeming points — the issued coupon `{ code? }`. */
export type RedeemCouponResult = RedeemCouponOut;

/** Body for `redeemMyPoints` — inlined upstream, so defined structurally. */
export interface RedeemMyPointsInput {
  redeemOptionId: string;
}
