import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { auth } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";

export interface UseCancelOrderVars {
  orderId: string;
  saasToken?: string;
}

/** Cancels (transitions to DECLINED) a customer's order. Invalidates ["emporix","orders"] on success. */
export function useCancelOrder(): UseMutationResult<void, unknown, string | UseCancelOrderVars> {
  const { client, storage } = useEmporix();
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["emporix", "orders", "cancel"],
    mutationFn: async (input) => {
      const token = storage.getCustomerToken();
      if (!token) throw new Error("useCancelOrder: requires a logged-in customer");
      const { orderId, saasToken } =
        typeof input === "string" ? { orderId: input, saasToken: undefined } : input;
      await client.orders.cancel(
        orderId,
        auth.customer(token),
        saasToken ? { saasToken } : {},
      );
    },
    onSuccess: () =>
      qc.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) && q.queryKey[1] === "orders",
      }),
  });
}
