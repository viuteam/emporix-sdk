import { inject, type Injector, type Signal } from "@angular/core";
import type {
  CreateInfiniteQueryResult,
  CreateQueryResult,
  InfiniteData,
} from "@tanstack/angular-query-experimental";
import {
  EmporixError,
  type EmporixClient,
  type EmporixStorage,
  type Order,
  type PaginatedItems,
} from "@viu/emporix-sdk";

import { EMPORIX_STORAGE } from "../tokens";
import { injectEmporix } from "../provide";
import { injectEmporixInfinite, injectEmporixQuery } from "../inject-query";
import { writeBundle } from "../write-bundle";

/** The status argument `orders.transition` accepts, derived rather than restated. */
type OrderStatusInput = Parameters<EmporixClient["orders"]["transition"]>[1];
type SalesOrderPatch = Parameters<EmporixClient["salesOrders"]["update"]>[1];

/**
 * One line of a placed order, as `reorder` needs to read it.
 *
 * Deliberately structural and all-optional: this is what the DTO carries in
 * practice across tenants, and a missing field is the case `reorder` has to
 * handle rather than crash on.
 */
interface OrderEntry {
  itemYrn?: string;
  orderedAmount?: number;
  amount?: number;
  price?: {
    priceId?: string;
    originalAmount?: number;
    effectiveAmount?: number;
    currency?: string;
  };
}

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

/** One sales order by id. Customer-scoped. */
export function injectSalesOrder(
  orderId: Signal<string>,
  opts: OrderOpts = {},
): CreateQueryResult<Order> {
  const { client } = injectEmporix();
  return injectEmporixQuery<Order, readonly [string]>(
    () => ({
      resource: "sales-order",
      args: [orderId()] as const,
      site: "none",
      mode: "customer",
      enabled: (opts.enabled ?? true) && orderId() !== "",
      // No staleTime: the `["emporix"]` default of 30 s applies, as it does to
      // every other order read in this file.
      queryFn: (ctx) => client.salesOrders.get(orderId(), ctx),
    }),
    pass(opts),
  );
}

/** What a reorder did. Partial success is the normal case, not an error. */
export interface ReorderResult {
  /** Batch entries Emporix accepted. */
  added: number;
  /** Order entries with no usable price row, so not re-addable at all. */
  skipped: number;
  /** One per rejected batch entry, carrying its status and message. */
  errors: Error[];
}

export interface EmporixOrderMutations {
  isPending: Signal<boolean>;
  error: Signal<Error | null>;
  /** Cancels by transitioning to `DECLINED`. The server decides whether that is legal. */
  cancel(vars: { orderId: string }): Promise<void>;
  /** Any status transition. The server enforces legality. */
  transition(vars: { orderId: string; status: OrderStatusInput; comment?: string }): Promise<void>;
  /** Patches a sales order. `recalculate` re-prices it server-side. */
  updateSalesOrder(vars: {
    orderId: string;
    patch: SalesOrderPatch;
    recalculate?: boolean;
  }): Promise<Order>;
  /** Re-adds a past order's lines to the active cart. See {@link ReorderResult}. */
  reorder(vars: { orderId: string; cartId?: string }): Promise<ReorderResult>;
}

/**
 * Order writes.
 *
 * The `saas-token` comes from storage rather than the caller. It is minted at
 * login and cannot be re-minted by a refresh, which is why the session persists
 * it — asking every call site to thread it through is how one of them forgets.
 *
 * `reorder` is the only method that is more than a call, and every line of it is
 * a shape that a port from the method names would get wrong: order lines live
 * under `entries`, each one needs a complete price row because Emporix requires
 * `priceId` on internal-type cart items, the quantity is `orderedAmount`, and the
 * batch response is a bare array of per-entry statuses. Partial failure is
 * reported rather than thrown: a shopper who got nine of ten lines wants to see
 * which one is missing, not an error page.
 */
export function injectOrderMutations(): EmporixOrderMutations {
  const { client } = injectEmporix();
  const storage: EmporixStorage = inject(EMPORIX_STORAGE);
  const b = writeBundle([
    ["emporix", "my-orders"],
    ["emporix", "my-orders-infinite"],
    ["emporix", "order"],
    ["emporix", "sales-order"],
    ["emporix", "cart"],
    ["emporix", "cart-items"],
  ]);

  const saas = (): { saasToken?: string } => {
    const token = storage.getSaasToken?.() ?? null;
    return token !== null ? { saasToken: token } : {};
  };

  return {
    isPending: b.isPending,
    error: b.error,
    cancel: (v) => b.write((ctx) => client.orders.cancel(v.orderId, ctx, saas())),
    transition: (v) =>
      b.write((ctx) =>
        client.orders.transition(v.orderId, v.status, ctx, {
          ...(v.comment !== undefined ? { comment: v.comment } : {}),
          ...saas(),
        }),
      ),
    updateSalesOrder: (v) =>
      b.write((ctx) =>
        client.salesOrders.update(
          v.orderId,
          v.patch,
          ctx,
          v.recalculate !== undefined ? { recalculate: v.recalculate } : {},
        ),
      ),
    reorder: (v) =>
      b.write(async (ctx): Promise<ReorderResult> => {
        const order = await client.orders.get(v.orderId, ctx, saas());
        const entries = (order as { entries?: OrderEntry[] }).entries ?? [];

        const body = entries
          .map((e) => {
            const p = e.price;
            // A line with no complete price row cannot be re-added: Emporix
            // requires `priceId` on internal-type items and answers 400 without
            // one. The price it was ordered at is re-validated at checkout.
            if (
              e.itemYrn === undefined ||
              p?.priceId === undefined ||
              p.originalAmount === undefined ||
              p.effectiveAmount === undefined ||
              p.currency === undefined
            ) {
              return null;
            }
            return {
              itemYrn: e.itemYrn,
              quantity: e.orderedAmount ?? e.amount ?? 1,
              price: {
                priceId: p.priceId,
                originalAmount: p.originalAmount,
                effectiveAmount: p.effectiveAmount,
                currency: p.currency,
              },
            };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);

        const skipped = entries.length - body.length;
        if (body.length === 0) return { added: 0, skipped, errors: [] };

        const cartId = v.cartId ?? storage.getCartId();
        if (cartId === null || cartId === undefined) {
          throw new EmporixError(
            "injectOrderMutations.reorder: no cartId available — bootstrap a cart first (injectActiveCart({ create: true }))",
          );
        }

        const res = await client.carts.addItemsBatch(cartId, body as never, ctx);
        let added = 0;
        const errors: Error[] = [];
        for (const entry of res) {
          if (entry.status >= 200 && entry.status < 300) {
            added += 1;
          } else {
            errors.push(
              new Error(
                `addItemsBatch entry ${entry.index ?? "?"}: status=${entry.status}${
                  entry.errorMessage !== undefined ? ` ${entry.errorMessage}` : ""
                }`,
              ),
            );
          }
        }
        return { added, skipped, errors };
      }),
  };
}
