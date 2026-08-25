import { type Injector, type Signal } from "@angular/core";
import type {
  CreateInfiniteQueryResult,
  CreateQueryResult,
  InfiniteData,
} from "@tanstack/angular-query-experimental";
import type { EmporixClient, Order, PaginatedItems } from "@viu/emporix-sdk";

import { injectEmporix } from "../provide";
import { injectEmporixInfinite, injectEmporixQuery } from "../inject-query";

/**
 * Derived from the facade, not restated.
 *
 * A hand-written `{ pageNumber?: number; … }` is not assignable under
 * `exactOptionalPropertyTypes` — an optional property read back is
 * `number | undefined`, which the target's `?:` does not accept. Deriving it also
 * means a new filter on the facade appears here for free.
 */
type MyOrdersParams = Parameters<EmporixClient["orders"]["listMine"]>[1];

export interface OrderOpts {
  injector?: Injector;
  enabled?: boolean;
}

const pass = (o: OrderOpts): { injector?: Injector } =>
  o.injector !== undefined ? { injector: o.injector } : {};

/**
 * The signed-in customer's orders, one page at a time.
 *
 * `mode: "customer"` — keyed for guest and customer alike so a guest's entry can
 * never be served to a customer, but only ever *enabled* with a token. A guest
 * issues no request at all.
 *
 * Page numbers rather than infinite scroll for the non-infinite variant: an order
 * history is a table you jump around in, and each page keeping its own cache entry
 * is what makes going back instant.
 */
export function injectMyOrders(
  params: Signal<MyOrdersParams>,
  opts: OrderOpts = {},
): CreateQueryResult<PaginatedItems<Order>> {
  const { client } = injectEmporix();
  return injectEmporixQuery<PaginatedItems<Order>, readonly [MyOrdersParams]>(
    () => ({
      resource: "my-orders",
      args: [params()] as const,
      site: "none",
      mode: "customer",
      ...(opts.enabled !== undefined ? { enabled: opts.enabled } : {}),
      queryFn: (ctx) => client.orders.listMine(ctx, params()),
    }),
    pass(opts),
  );
}

/** The same list, paginated for infinite scroll. Terminates on `hasNextPage`. */
export function injectMyOrdersInfinite(
  pageSize: Signal<number>,
  opts: OrderOpts = {},
): CreateInfiniteQueryResult<InfiniteData<PaginatedItems<Order>, number>> {
  const { client } = injectEmporix();
  return injectEmporixInfinite<Order, readonly [number]>(
    () => ({
      resource: "my-orders-infinite",
      args: [pageSize()] as const,
      site: "none",
      mode: "customer",
      ...(opts.enabled !== undefined ? { enabled: opts.enabled } : {}),
      fetchPage: (pageNumber, ctx) =>
        client.orders.listMine(ctx, { pageNumber, pageSize: pageSize() }),
    }),
    pass(opts),
  );
}

/** One order by id. Customer-gated: an order is never a public read. */
export function injectOrder(
  orderId: Signal<string>,
  opts: OrderOpts = {},
): CreateQueryResult<Order> {
  const { client } = injectEmporix();
  return injectEmporixQuery<Order, readonly [string]>(
    () => ({
      resource: "order",
      args: [orderId()] as const,
      site: "none",
      mode: "customer",
      enabled: (opts.enabled ?? true) && orderId() !== "",
      queryFn: (ctx) => client.orders.get(orderId(), ctx),
    }),
    pass(opts),
  );
}
