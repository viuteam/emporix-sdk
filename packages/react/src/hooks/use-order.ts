import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { auth, type Order } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { emporixKey } from "./internal/query-keys";
import { useReadSite } from "./internal/use-read-site";
import { useCustomerToken } from "./internal/use-storage-snapshot";

export interface UseOrderOptions {
  saasToken?: string;
}

/** Single-order read by id. Disabled without a customer token or when orderId is undefined. */
export function useOrder(
  orderId: string | undefined,
  options: UseOrderOptions = {},
): UseQueryResult<Order> {
  const { client } = useEmporix();
  const token = useCustomerToken();
  const { language } = useReadSite();
  return useQuery({
    queryKey: emporixKey("orders", [orderId ?? null], {
      tenant: client.tenant,
      authKind: token ? "customer" : "anonymous",
      language,
    }),
    enabled: token !== null && orderId !== undefined,
    queryFn: () =>
      client.orders.get(
        orderId as string,
        auth.customer(token as string),
        options.saasToken ? { saasToken: options.saasToken } : {},
      ),
  });
}
