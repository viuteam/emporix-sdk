import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from "@tanstack/react-query";
import type { Return, ReturnList, ReturnInput, ReturnCreated } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useCustomerOnlyCtx } from "./internal/use-read-auth";
import { emporixKey } from "./internal/query-keys";

const STALE = 30_000;
const INVALIDATE_KEY = ["emporix", "returns"] as const;

/** The signed-in customer's returns (customer-only). */
export function useMyReturns(
  opts: { query?: Record<string, string | number> } = {},
): UseQueryResult<ReturnList> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  return useQuery({
    queryKey: emporixKey("returns", [opts.query ?? null], { tenant: client.tenant, authKind: ctx.kind }),
    queryFn: () => client.returns.listReturns(opts.query ?? {}, ctx),
    staleTime: STALE,
  });
}

/** A single return by id (customer-only). */
export function useReturn(returnId: string | undefined): UseQueryResult<Return> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  return useQuery({
    queryKey: emporixKey("returns", [returnId ?? null], { tenant: client.tenant, authKind: ctx.kind }),
    queryFn: () => client.returns.getReturn(returnId as string, ctx),
    enabled: Boolean(returnId),
    staleTime: STALE,
  });
}

/** Create a return for the signed-in customer. Invalidates the returns list. */
export function useCreateReturn(): UseMutationResult<ReturnCreated, unknown, ReturnInput> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ReturnInput) => client.returns.createReturn(input, ctx),
    onSuccess: () => void qc.invalidateQueries({ queryKey: INVALIDATE_KEY }),
  });
}
