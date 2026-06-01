import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from "@tanstack/react-query";
import type {
  PointsSummary,
  RedeemOptionList,
  RedeemMyPointsInput,
  RedeemCouponResult,
} from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useCustomerOnlyCtx, useReadAuth } from "./internal/use-read-auth";
import { emporixKey } from "./internal/query-keys";

const STALE = 30_000;
const INVALIDATE_KEY = ["emporix", "reward-points"] as const;

/** The signed-in customer's reward-points balance (customer-only). */
export function useMyRewardPoints(): UseQueryResult<number> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  return useQuery({
    queryKey: emporixKey("reward-points", ["mine"], { tenant: client.tenant, authKind: ctx.kind }),
    queryFn: () => client.rewardPoints.getMyPoints(ctx),
    staleTime: STALE,
  });
}

/** The signed-in customer's reward-points summary (customer-only). */
export function useMyRewardPointsSummary(): UseQueryResult<PointsSummary> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  return useQuery({
    queryKey: emporixKey("reward-points", ["mine", "summary"], { tenant: client.tenant, authKind: ctx.kind }),
    queryFn: () => client.rewardPoints.getMySummary(ctx),
    staleTime: STALE,
  });
}

/** List redeem options (works for guests and customers). */
export function useRedeemOptions(): UseQueryResult<RedeemOptionList> {
  const { client } = useEmporix();
  const { ctx } = useReadAuth();
  return useQuery({
    queryKey: emporixKey("reward-points", ["redeem-options"], { tenant: client.tenant, authKind: ctx.kind }),
    queryFn: () => client.rewardPoints.listRedeemOptions(ctx),
    staleTime: STALE,
  });
}

/** Redeem the signed-in customer's points for a coupon code. */
export function useRedeemRewardPoints(): UseMutationResult<RedeemCouponResult, unknown, RedeemMyPointsInput> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RedeemMyPointsInput) => client.rewardPoints.redeemMyPoints(input, ctx),
    onSuccess: () => void qc.invalidateQueries({ queryKey: INVALIDATE_KEY }),
  });
}
