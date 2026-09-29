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
import { useCustomerCtxResolver, useReadAuth } from "./internal/use-read-auth";
import { useEmporixQuery } from "./internal/use-emporix-query";
import { emporixKey } from "./internal/query-keys";

const STALE = 30_000;
const INVALIDATE_KEY = ["emporix", "reward-points"] as const;

/** The signed-in customer's reward-points balance. Disabled until a customer token exists. */
export function useMyRewardPoints(): UseQueryResult<number> {
  const { client } = useEmporix();
  return useEmporixQuery({
    mode: "customer", site: "none", resource: "reward-points", args: ["mine"],
    queryFn: (ctx) => client.rewardPoints.getMyPoints(ctx),
    staleTime: STALE,
  });
}

/** The signed-in customer's reward-points summary. Disabled until a customer token exists. */
export function useMyRewardPointsSummary(): UseQueryResult<PointsSummary> {
  const { client } = useEmporix();
  return useEmporixQuery({
    mode: "customer", site: "none", resource: "reward-points", args: ["mine", "summary"],
    queryFn: (ctx) => client.rewardPoints.getMySummary(ctx),
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

/**
 * Redeem the signed-in customer's points for a coupon code. Without a customer
 * token the mutation fails; rendering does not.
 */
export function useRedeemRewardPoints(): UseMutationResult<RedeemCouponResult, unknown, RedeemMyPointsInput> {
  const { client } = useEmporix();
  const customerCtx = useCustomerCtxResolver();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RedeemMyPointsInput) => client.rewardPoints.redeemMyPoints(input, customerCtx()),
    onSuccess: () => void qc.invalidateQueries({ queryKey: INVALIDATE_KEY }),
  });
}
