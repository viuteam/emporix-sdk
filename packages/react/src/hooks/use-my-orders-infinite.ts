import type { UseInfiniteQueryResult } from "@tanstack/react-query";
import { auth, type Order, type OrderStatus, type PaginatedItems } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useActiveCompany } from "../company-context";
import { useEmporixInfinite } from "./internal/use-emporix-infinite";
import { emporixKey } from "./internal/query-keys";
import { useReadSite } from "./internal/use-read-site";

export interface UseMyOrdersInfiniteOptions {
  pageSize?: number;
  status?: OrderStatus;
  legalEntityId?: string | null;
  saasToken?: string;
}

/** Infinite paginated read of customer orders. Same defaulting rules as useMyOrders. */
export function useMyOrdersInfinite(
  options: UseMyOrdersInfiniteOptions = {},
): UseInfiniteQueryResult<{ pages: PaginatedItems<Order>[]; pageParams: number[] }> {
  const { client, storage } = useEmporix();
  const { activeCompany } = useActiveCompany();
  const { siteCode } = useReadSite();
  const token = storage.getCustomerToken();
  const effectiveLE: string | undefined =
    options.legalEntityId === null
      ? undefined
      : (options.legalEntityId ?? activeCompany?.id);
  return useEmporixInfinite<Order>({
    queryKey: emporixKey(
      "orders",
      ["mine-infinite", effectiveLE ?? null, options.status ?? null, options.pageSize ?? null],
      { tenant: client.tenant, authKind: token ? "customer" : "anonymous", siteCode },
    ),
    enabled: token !== null,
    fetchPage: (pageNumber) =>
      client.orders.listMine(auth.customer(token as string), {
        pageNumber,
        ...(options.pageSize !== undefined ? { pageSize: options.pageSize } : {}),
        ...(options.status !== undefined ? { status: options.status } : {}),
        ...(effectiveLE !== undefined ? { legalEntityId: effectiveLE } : {}),
        ...(siteCode ? { siteCode } : {}),
        ...(options.saasToken !== undefined ? { saasToken: options.saasToken } : {}),
      }),
  });
}
