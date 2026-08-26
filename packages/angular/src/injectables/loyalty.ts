import { type Injector, type Signal } from "@angular/core";
import type { CreateQueryResult } from "@tanstack/angular-query-experimental";
import type { EmporixClient } from "@viu/emporix-sdk";
import { injectEmporix } from "../provide";
import { injectEmporixQuery } from "../inject-query";
import { writeBundle } from "../write-bundle";

type PointsSummary = Awaited<ReturnType<EmporixClient["rewardPoints"]["getMySummary"]>>;
type RedeemOptions = Awaited<ReturnType<EmporixClient["rewardPoints"]["listRedeemOptions"]>>;
type RedeemInput = Parameters<EmporixClient["rewardPoints"]["redeemMyPoints"]>[0];
type RedeemResult = Awaited<ReturnType<EmporixClient["rewardPoints"]["redeemMyPoints"]>>;
type CouponRedemption = Parameters<EmporixClient["coupons"]["redeemCoupon"]>[1];
type RedemptionCreated = Awaited<ReturnType<EmporixClient["coupons"]["redeemCoupon"]>>;

/** 1 minute — a balance moves only when the customer spends or earns. */
const POINTS_STALE = 60_000;
/** 10 minutes — redeem options are admin-configured. */
const OPTIONS_STALE = 10 * 60_000;

export interface LoyaltyOpts {
  injector?: Injector;
  enabled?: boolean;
}

const pass = (o: LoyaltyOpts): { injector?: Injector } =>
  o.injector !== undefined ? { injector: o.injector } : {};

/**
 * The signed-in customer's reward-point balance.
 *
 * A plain `number`, not an object — and `0` rather than an error for a customer
 * who has never earned any. The facade maps Emporix's 404 «No reward points
 * found» to zero, because for the signed-in customer that is what it means.
 */
export function injectMyRewardPoints(
  opts: LoyaltyOpts = {},
): CreateQueryResult<number> {
  const { client } = injectEmporix();
  return injectEmporixQuery<number, readonly []>(
    () => ({
      resource: "reward-points",
      args: [] as const,
      site: "none",
      mode: "customer",
      ...(opts.enabled !== undefined ? { enabled: opts.enabled } : {}),
      queryFn: (ctx) => client.rewardPoints.getMyPoints(ctx),
      staleTime: POINTS_STALE,
    }),
    pass(opts),
  );
}

/** Active points plus history. Empty rather than an error for a customer with no entry. */
export function injectMyRewardPointsSummary(
  opts: LoyaltyOpts = {},
): CreateQueryResult<PointsSummary> {
  const { client } = injectEmporix();
  return injectEmporixQuery<PointsSummary, readonly []>(
    () => ({
      resource: "reward-points-summary",
      args: [] as const,
      site: "none",
      mode: "customer",
      ...(opts.enabled !== undefined ? { enabled: opts.enabled } : {}),
      queryFn: (ctx) => client.rewardPoints.getMySummary(ctx),
      staleTime: POINTS_STALE,
    }),
    pass(opts),
  );
}

/**
 * What points can be redeemed for.
 *
 * `mode: "customer"`, which is also what makes this callable at all: the facade
 * defaults to a **service** context because managing options is service-only,
 * but the read itself is open to a customer token. A storefront must pass one —
 * reaching for the default here would send a service context from the browser.
 */
export function injectRedeemOptions(
  opts: LoyaltyOpts = {},
): CreateQueryResult<RedeemOptions> {
  const { client } = injectEmporix();
  return injectEmporixQuery<RedeemOptions, readonly []>(
    () => ({
      resource: "reward-redeem-options",
      args: [] as const,
      site: "none",
      mode: "customer",
      ...(opts.enabled !== undefined ? { enabled: opts.enabled } : {}),
      queryFn: (ctx) => client.rewardPoints.listRedeemOptions(ctx),
      staleTime: OPTIONS_STALE,
    }),
    pass(opts),
  );
}

export interface EmporixRewardPointMutations {
  isPending: Signal<boolean>;
  error: Signal<Error | null>;
  /** Redeems points for a coupon. Invalidates the balance and the summary. */
  redeem(input: RedeemInput): Promise<RedeemResult>;
}

export function injectRewardPointMutations(): EmporixRewardPointMutations {
  const { client } = injectEmporix();
  const b = writeBundle(
    [
      ["emporix", "reward-points"],
      ["emporix", "reward-points-summary"],
    ],
    { customerOnly: true },
  );
  return {
    isPending: b.isPending,
    error: b.error,
    redeem: (input) =>
      b.write((ctx) => client.rewardPoints.redeemMyPoints(input, ctx), "redeemRewardPoints"),
  };
}

export interface EmporixCouponMutations {
  isPending: Signal<boolean>;
  error: Signal<Error | null>;
  /** Checks a code against a redemption without consuming it. */
  validate(vars: { code: string; redemption: CouponRedemption }): Promise<void>;
  /** Consumes a code. Invalidates the cart, whose totals change. */
  redeem(vars: { code: string; redemption: CouponRedemption }): Promise<RedemptionCreated>;
}

/**
 * Coupon validate and redeem.
 *
 * Both are writes, even though «validate» reads like a query: Emporix records
 * the attempt against the redemption, so it must not be cached and a re-render
 * must not repeat it. That is also why neither is an `inject…Query`.
 */
export function injectCouponMutations(): EmporixCouponMutations {
  const { client } = injectEmporix();
  const b = writeBundle(
    [
      ["emporix", "cart"],
      ["emporix", "cart-items"],
    ],
    { customerOnly: true },
  );
  return {
    isPending: b.isPending,
    error: b.error,
    validate: (v) =>
      b.write((ctx) => client.coupons.validateCoupon(v.code, v.redemption, ctx), "validateCoupon"),
    redeem: (v) =>
      b.write((ctx) => client.coupons.redeemCoupon(v.code, v.redemption, ctx), "redeemCoupon"),
  };
}
