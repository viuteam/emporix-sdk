import {
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from "@tanstack/react-query";
import type { Return, ReturnList, ReturnInput, ReturnCreated } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useCustomerCtxResolver } from "./internal/use-read-auth";
import { useEmporixQuery } from "./internal/use-emporix-query";

const STALE = 30_000;
const INVALIDATE_KEY = ["emporix", "returns"] as const;

/** The signed-in customer's returns. Disabled until a customer token exists. */
export function useMyReturns(
  opts: { query?: Record<string, string | number> } = {},
): UseQueryResult<ReturnList> {
  const { client } = useEmporix();
  return useEmporixQuery({
    mode: "customer", site: "none", resource: "returns", args: [opts.query ?? null],
    queryFn: (ctx) => client.returns.listReturns(opts.query ?? {}, ctx),
    staleTime: STALE,
  });
}

/** A single return by id. Disabled until a customer token exists, or without an id. */
export function useReturn(returnId: string | undefined): UseQueryResult<Return> {
  const { client } = useEmporix();
  return useEmporixQuery({
    mode: "customer", site: "none", resource: "returns", args: [returnId ?? null],
    enabled: Boolean(returnId),
    queryFn: (ctx) => client.returns.getReturn(returnId as string, ctx),
    staleTime: STALE,
  });
}

/**
 * Create a return for the signed-in customer. Invalidates the returns list.
 * Without a customer token the mutation fails; rendering does not.
 */
export function useCreateReturn(): UseMutationResult<ReturnCreated, unknown, ReturnInput> {
  const { client } = useEmporix();
  const customerCtx = useCustomerCtxResolver();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ReturnInput) => client.returns.createReturn(input, customerCtx()),
    onSuccess: () => void qc.invalidateQueries({ queryKey: INVALIDATE_KEY }),
  });
}
