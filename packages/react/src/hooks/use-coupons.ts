import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { RedemptionInput, RedemptionCreated } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useReadAuth } from "./internal/use-read-auth";

const INVALIDATE_KEY = ["emporix", "coupons"] as const;

/** Variables for the coupon action hooks. */
export interface CouponActionVars {
  code: string;
  redemption: RedemptionInput;
}

/**
 * Check whether a coupon can be redeemed for the current shopper. Resolves on
 * success (redeemable); the mutation enters `isError` when the coupon is not
 * redeemable. Uses the browser auth context (customer if logged in, else
 * anonymous) — never the service token.
 */
export function useValidateCoupon(): UseMutationResult<void, unknown, CouponActionVars> {
  const { client } = useEmporix();
  const { ctx } = useReadAuth();
  return useMutation({
    mutationFn: ({ code, redemption }: CouponActionVars) =>
      client.coupons.validateCoupon(code, redemption, ctx),
  });
}

/**
 * Redeem a coupon for the current shopper (creates a redemption). Invalidates
 * the `["emporix", "coupons"]` cache on success.
 */
export function useRedeemCoupon(): UseMutationResult<RedemptionCreated, unknown, CouponActionVars> {
  const { client } = useEmporix();
  const { ctx } = useReadAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ code, redemption }: CouponActionVars) =>
      client.coupons.redeemCoupon(code, redemption, ctx),
    onSuccess: () => void qc.invalidateQueries({ queryKey: INVALIDATE_KEY }),
  });
}
