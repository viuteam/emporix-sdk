import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from "@tanstack/react-query";
import type {
  Approval,
  ApprovalList,
  ApprovalInput,
  ApprovalPatch,
  ApprovalCreated,
} from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useCustomerOnlyCtx } from "./internal/use-read-auth";
import { emporixKey } from "./internal/query-keys";

const STALE = 30_000;
const INVALIDATE_KEY = ["emporix", "approvals"] as const;

/** The signed-in customer's approvals (customer-only). */
export function useApprovals(
  opts: { query?: Record<string, string | number> } = {},
): UseQueryResult<ApprovalList> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  return useQuery({
    queryKey: emporixKey("approvals", [opts.query ?? null], { tenant: client.tenant, authKind: ctx.kind }),
    queryFn: () => client.approvals.listApprovals(opts.query ?? {}, ctx),
    staleTime: STALE,
  });
}

/** A single approval by id (customer-only). */
export function useApproval(approvalId: string | undefined): UseQueryResult<Approval> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  return useQuery({
    queryKey: emporixKey("approvals", [approvalId ?? null], { tenant: client.tenant, authKind: ctx.kind }),
    queryFn: () => client.approvals.getApproval(approvalId as string, ctx),
    enabled: Boolean(approvalId),
    staleTime: STALE,
  });
}

/** Create an approval request for the signed-in customer. Invalidates the list. */
export function useCreateApproval(): UseMutationResult<ApprovalCreated, unknown, ApprovalInput> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ApprovalInput) => client.approvals.createApproval(input, ctx),
    onSuccess: () => void qc.invalidateQueries({ queryKey: INVALIDATE_KEY }),
  });
}

/** Variables for {@link useUpdateApproval}. */
export interface UseUpdateApprovalVars {
  approvalId: string;
  /** JSON-Patch op-array — e.g. `[{ op: "replace", path: "/status", value: "APPROVED" }]`. */
  ops: ApprovalPatch;
}

/** Approve/reject/amend an approval via JSON-Patch (customer-only). Invalidates the list. */
export function useUpdateApproval(): UseMutationResult<void, unknown, UseUpdateApprovalVars> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ approvalId, ops }: UseUpdateApprovalVars) =>
      client.approvals.updateApproval(approvalId, ops, ctx),
    onSuccess: () => void qc.invalidateQueries({ queryKey: INVALIDATE_KEY }),
  });
}
