import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { type AuthContext, type Order } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { emporixKey } from "./internal/query-keys";
import { useReadSite } from "./internal/use-read-site";

/** Service-account read of a single sales-order. Disabled when `auth` is undefined. */
export function useSalesOrder(
  orderId: string | undefined,
  authCtx: AuthContext | undefined,
): UseQueryResult<Order> {
  const { client } = useEmporix();
  const { language } = useReadSite();
  return useQuery({
    queryKey: emporixKey("salesorders", [orderId ?? null], {
      tenant: client.tenant,
      authKind: authCtx?.kind ?? "anonymous",
      language,
    }),
    enabled: orderId !== undefined && authCtx !== undefined,
    queryFn: () => client.salesOrders.get(orderId as string, authCtx as AuthContext),
  });
}
