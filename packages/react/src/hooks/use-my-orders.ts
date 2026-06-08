import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { auth, type Order, type OrderStatus, type PaginatedItems } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useActiveCompany } from "../company-context";
import { emporixKey } from "./internal/query-keys";
import { useReadSite } from "./internal/use-read-site";

/** Options for `useMyOrders`. Passing `legalEntityId: null` disables the active-company auto-default. */
export interface UseMyOrdersOptions {
  pageNumber?: number;
  pageSize?: number;
  status?: OrderStatus;
  /** `undefined` = default from `useActiveCompany`. `null` = no filter. */
  legalEntityId?: string | null;
  saasToken?: string;
}

/** Paginated read of the customer's own orders. Disabled without a customer token. */
export function useMyOrders(
  options: UseMyOrdersOptions = {},
): UseQueryResult<PaginatedItems<Order>> {
  const { client, storage } = useEmporix();
  const { activeCompany } = useActiveCompany();
  const { siteCode, language } = useReadSite();
  const token = storage.getCustomerToken();
  const effectiveLE: string | undefined =
    options.legalEntityId === null
      ? undefined
      : (options.legalEntityId ?? activeCompany?.id);
  return useQuery({
    queryKey: emporixKey(
      "orders",
      ["mine", effectiveLE ?? null, options.status ?? null, options.pageNumber ?? 1, options.pageSize ?? null],
      { tenant: client.tenant, authKind: token ? "customer" : "anonymous", siteCode, language },
    ),
    enabled: token !== null,
    queryFn: () =>
      client.orders.listMine(auth.customer(token as string), {
        ...(options.pageNumber !== undefined ? { pageNumber: options.pageNumber } : {}),
        ...(options.pageSize !== undefined ? { pageSize: options.pageSize } : {}),
        ...(options.status !== undefined ? { status: options.status } : {}),
        ...(effectiveLE !== undefined ? { legalEntityId: effectiveLE } : {}),
        ...(siteCode ? { siteCode } : {}),
        ...(options.saasToken !== undefined ? { saasToken: options.saasToken } : {}),
      }),
  });
}
