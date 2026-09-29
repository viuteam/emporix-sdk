import { type UseQueryResult } from "@tanstack/react-query";
import { type Transition } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useEmporixQuery } from "./internal/use-emporix-query";

export interface UseOrderTransitionsOptions {
  saasToken?: string;
}

/**
 * The status transitions the customer may trigger on one of their orders — for
 * example whether it can still be cancelled. Disabled without a customer token
 * or when `orderId` is undefined. Keyed under `["emporix", "orders"]`, so a
 * successful `useOrderTransition` or `useCancelOrder` refreshes it.
 */
export function useOrderTransitions(
  orderId: string | undefined,
  options: UseOrderTransitionsOptions = {},
): UseQueryResult<Transition[]> {
  const { client } = useEmporix();
  return useEmporixQuery({
    mode: "customer", site: "none", resource: "orders", args: ["transitions", orderId ?? null],
    enabled: orderId !== undefined,
    queryFn: (ctx) =>
      client.orders.listTransitions(
        orderId as string,
        ctx,
        options.saasToken ? { saasToken: options.saasToken } : {},
      ),
  });
}
