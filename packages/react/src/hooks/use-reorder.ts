import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { auth, type Order } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { emporixKey } from "./internal/query-keys";

export interface UseReorderVars {
  orderId: string;
  saasToken?: string;
}

export interface UseReorderResult {
  added: number;
  errors: unknown[];
}

/**
 * Re-populates the active cart from a past order. Best-effort: each
 * `cart.addItem` runs sequentially; item-level failures are collected in
 * `errors[]` instead of throwing. Returns `{ added, errors }`.
 */
export function useReorder(): UseMutationResult<UseReorderResult, unknown, UseReorderVars> {
  const { client, storage } = useEmporix();
  const qc = useQueryClient();
  return useMutation<UseReorderResult, unknown, UseReorderVars>({
    mutationKey: ["emporix", "orders", "reorder"],
    mutationFn: async ({ orderId, saasToken }) => {
      const token = storage.getCustomerToken();
      if (!token) throw new Error("useReorder: requires a logged-in customer");
      const ctx = auth.customer(token);

      const order = await qc.fetchQuery<Order>({
        queryKey: emporixKey("orders", [orderId], { tenant: client.tenant, authKind: ctx.kind }),
        queryFn: () =>
          client.orders.get(orderId, ctx, saasToken ? { saasToken } : {}),
      });

      const cartId = storage.getCartId();
      if (!cartId) throw new Error("useReorder: no active cart id in storage");

      let added = 0;
      const errors: unknown[] = [];
      for (const item of order.items) {
        try {
          await client.carts.addItem(
            cartId,
            { product: { id: item.productId }, quantity: item.quantity } as never,
            ctx,
          );
          added += 1;
        } catch (e) {
          errors.push(e);
        }
      }
      return { added, errors };
    },
    onSuccess: () => {
      qc.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[1] === "cart" });
    },
  });
}
