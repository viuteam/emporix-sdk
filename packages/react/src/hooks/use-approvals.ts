import {
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
import { useCustomerCtxResolver } from "./internal/use-read-auth";
import { useEmporixQuery } from "./internal/use-emporix-query";

const STALE = 30_000;
const INVALIDATE_KEY = ["emporix", "approvals"] as const;

/** The signed-in customer's approvals. Disabled until a customer token exists. */
export function useApprovals(
  opts: { query?: Record<string, string | number> } = {},
): UseQueryResult<ApprovalList> {
  const { client } = useEmporix();
  return useEmporixQuery({
    mode: "customer", site: "none", resource: "approvals", args: [opts.query ?? null],
    queryFn: (ctx) => client.approvals.listApprovals(opts.query ?? {}, ctx),
    staleTime: STALE,
  });
}

/** A single approval by id. Disabled until a customer token exists, or without an id. */
export function useApproval(approvalId: string | undefined): UseQueryResult<Approval> {
  const { client } = useEmporix();
  return useEmporixQuery({
    mode: "customer", site: "none", resource: "approvals", args: [approvalId ?? null],
    enabled: Boolean(approvalId),
    queryFn: (ctx) => client.approvals.getApproval(approvalId as string, ctx),
    staleTime: STALE,
  });
}

/**
 * Create an approval request for the signed-in customer. Invalidates the list.
 * Without a customer token the mutation fails; rendering does not.
 */
export function useCreateApproval(): UseMutationResult<ApprovalCreated, unknown, ApprovalInput> {
  const { client } = useEmporix();
  const customerCtx = useCustomerCtxResolver();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ApprovalInput) => client.approvals.createApproval(input, customerCtx()),
    onSuccess: () => void qc.invalidateQueries({ queryKey: INVALIDATE_KEY }),
  });
}

/** Variables for {@link useUpdateApproval}. */
export interface UseUpdateApprovalVars {
  approvalId: string;
  /** JSON-Patch op-array — e.g. `[{ op: "replace", path: "/status", value: "APPROVED" }]`. */
  ops: ApprovalPatch;
}

/**
 * Approve/reject/amend an approval via JSON-Patch. Invalidates the list.
 * Without a customer token the mutation fails; rendering does not.
 */
export function useUpdateApproval(): UseMutationResult<void, unknown, UseUpdateApprovalVars> {
  const { client } = useEmporix();
  const customerCtx = useCustomerCtxResolver();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ approvalId, ops }: UseUpdateApprovalVars) =>
      client.approvals.updateApproval(approvalId, ops, customerCtx()),
    onSuccess: () => void qc.invalidateQueries({ queryKey: INVALIDATE_KEY }),
  });
}
