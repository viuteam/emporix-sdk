import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { auth, productIdFromYrn, type Order } from "@viu/emporix-sdk";
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
 * Re-populates the active cart from a past order via a single
 * `cart.addItemsBatch` call. Best-effort: item-level failures land in
 * `errors[]` instead of throwing; partial-success result shape stays
 * `{ added, errors }`.
 *
 * Emporix's batch endpoint caps at 200 items per request. Orders with more
 * line-items are not supported here — extend with chunking if a real use
 * case appears.
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

      const entries = order.entries ?? [];
      if (entries.length === 0) return { added: 0, errors: [] };

      const batchBody = entries.map((entry) => ({
        product: { id: (entry.product as { id?: string } | undefined)?.id ?? productIdFromYrn(entry.itemYrn) },
        quantity: entry.orderedAmount ?? entry.amount,
      })) as never;
      const res = await client.carts.addItemsBatch(cartId, batchBody, ctx);
      let added = 0;
      const errors: unknown[] = [];
      for (const entry of res) {
        if (entry.status >= 200 && entry.status < 300) {
          added += 1;
        } else {
          errors.push(
            new Error(
              `addItemsBatch entry ${entry.index ?? "?"}: status=${entry.status}${entry.errorMessage ? " " + entry.errorMessage : ""}`,
            ),
          );
        }
      }
      return { added, errors };
    },
    onSuccess: () => {
      qc.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[1] === "cart" });
    },
  });
}
