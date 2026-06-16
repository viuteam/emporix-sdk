import { type UseQueryResult } from "@tanstack/react-query";
import { type Order, type OrderStatus, type PaginatedItems, type QueryFor } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useActiveCompany } from "../company-context";
import { useReadSite } from "./internal/use-read-site";
import { useEmporixQuery } from "./internal/use-emporix-query";

/** Options for `useMyOrders`. Passing `legalEntityId: null` disables the active-company auto-default. */
export interface UseMyOrdersOptions {
  pageNumber?: number;
  pageSize?: number;
  status?: OrderStatus;
  /** `undefined` = default from `useActiveCompany`. `null` = no filter. */
  legalEntityId?: string | null;
  saasToken?: string;
  /** A `q` filter — raw DSL string or a built filter (e.g. mixinQuery for entity "ORDER"). */
  q?: QueryFor<"ORDER">;
}

/** Paginated read of the customer's own orders. Disabled without a customer token. */
export function useMyOrders(
  options: UseMyOrdersOptions = {},
): UseQueryResult<PaginatedItems<Order>> {
  const { client } = useEmporix();
  const { activeCompany } = useActiveCompany();
  const { siteCode } = useReadSite();
  const effectiveLE: string | undefined =
    options.legalEntityId === null
      ? undefined
      : (options.legalEntityId ?? activeCompany?.id);
  const qStr =
    options.q === undefined ? null : typeof options.q === "string" ? options.q : options.q.toString();
  return useEmporixQuery({
    mode: "customer", site: "full", resource: "orders",
    args: ["mine", effectiveLE ?? null, options.status ?? null, options.pageNumber ?? 1, options.pageSize ?? null, qStr],
    queryFn: (ctx) =>
      client.orders.listMine(ctx, {
        ...(options.pageNumber !== undefined ? { pageNumber: options.pageNumber } : {}),
        ...(options.pageSize !== undefined ? { pageSize: options.pageSize } : {}),
        ...(options.status !== undefined ? { status: options.status } : {}),
        ...(effectiveLE !== undefined ? { legalEntityId: effectiveLE } : {}),
        ...(siteCode ? { siteCode } : {}),
        ...(options.saasToken !== undefined ? { saasToken: options.saasToken } : {}),
        ...(options.q !== undefined ? { q: options.q } : {}),
      }),
  });
}
