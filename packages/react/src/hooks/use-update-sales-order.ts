import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { type AuthContext, type Order, type SalesOrderPatch } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";

export interface UseUpdateSalesOrderVars {
  orderId: string;
  patch: SalesOrderPatch;
  auth: AuthContext;
  recalculate?: boolean;
}

/**
 * Service-account update of a sales-order. Invalidates both
 * ["emporix","salesorders",id] and ["emporix","orders",id] (the customer-view
 * cache for the same order) on success.
 */
export function useUpdateSalesOrder(): UseMutationResult<Order, unknown, UseUpdateSalesOrderVars> {
  const { client } = useEmporix();
  const qc = useQueryClient();
  return useMutation<Order, unknown, UseUpdateSalesOrderVars>({
    mutationKey: ["emporix", "salesorders", "update"],
    mutationFn: async ({ orderId, patch, auth, recalculate }) => {
      if (!auth) throw new Error("useUpdateSalesOrder: requires an auth context");
      return client.salesOrders.update(
        orderId,
        patch,
        auth,
        recalculate !== undefined ? { recalculate } : {},
      );
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          (q.queryKey[1] === "salesorders" || (q.queryKey[1] === "orders" && q.queryKey[2] === vars.orderId)),
      });
    },
  });
}
