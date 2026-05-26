import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { auth, type OrderStatus } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";

export interface UseOrderTransitionVars {
  orderId: string;
  status: OrderStatus;
  comment?: string;
  saasToken?: string;
}

/** Generic status transition. Server enforces legality. Invalidates ["emporix","orders"] on success. */
export function useOrderTransition(): UseMutationResult<void, unknown, UseOrderTransitionVars> {
  const { client, storage } = useEmporix();
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ["emporix", "orders", "transition"],
    mutationFn: async ({ orderId, status, comment, saasToken }) => {
      const token = storage.getCustomerToken();
      if (!token) throw new Error("useOrderTransition: requires a logged-in customer");
      await client.orders.transition(
        orderId,
        status,
        auth.customer(token),
        {
          ...(comment !== undefined ? { comment } : {}),
          ...(saasToken !== undefined ? { saasToken } : {}),
        },
      );
    },
    onSuccess: () =>
      qc.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) && q.queryKey[1] === "orders",
      }),
  });
}
