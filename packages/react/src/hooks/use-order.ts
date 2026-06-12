import { type UseQueryResult } from "@tanstack/react-query";
import { type Order } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useEmporixQuery } from "./internal/use-emporix-query";

export interface UseOrderOptions {
  saasToken?: string;
}

/** Single-order read by id. Disabled without a customer token or when orderId is undefined. */
export function useOrder(
  orderId: string | undefined,
  options: UseOrderOptions = {},
): UseQueryResult<Order> {
  const { client } = useEmporix();
  return useEmporixQuery({
    mode: "customer", site: "language", resource: "orders", args: [orderId ?? null],
    enabled: orderId !== undefined,
    queryFn: (ctx) =>
      client.orders.get(
        orderId as string,
        ctx,
        options.saasToken ? { saasToken: options.saasToken } : {},
      ),
  });
}
