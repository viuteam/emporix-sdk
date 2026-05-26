import type { ClientContext, PaginatedItems } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  Order,
  OrderStatus,
  SalesOrderPatch,
} from "../generated/order-v2";

/** Optional fields supported by the order-v2 list endpoint. */
export interface ListMyOrdersOptions {
  pageNumber?: number;
  pageSize?: number;
  status?: OrderStatus;
  legalEntityId?: string;
  siteCode?: string;
  saasToken?: string;
}

/** Options for single-order reads (saas-token only). */
export interface GetOrderOptions {
  saasToken?: string;
}

/** Options for status transitions. */
export interface OrderTransitionOptions {
  saasToken?: string;
  comment?: string;
}

/** Options for `salesOrders.update`. */
export interface UpdateSalesOrderOptions {
  /** Forwarded as `?recalculate=`. Omit to use the server default (true). */
  recalculate?: boolean;
}

function setIfDefined<V>(
  q: Record<string, string | number | undefined>,
  key: string,
  value: V | undefined,
): void {
  if (value !== undefined && value !== "") {
    q[key] = value as unknown as string | number;
  }
}

/**
 * Storefront-customer access to Order-v2's customer endpoints.
 *
 * `listMine`/`get` require `order.order_read_own`; transitions require
 * `order.order_manage_own`. All methods accept an optional `saasToken` that
 * is passed as the `saas-token` header (mirrors `checkout.placeOrder`).
 */
export class OrdersService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/order-v2/${this.ctx.tenant}/orders`;
  }

  private saasHeader(saasToken: string | undefined): Record<string, string> | undefined {
    return saasToken ? { "saas-token": saasToken } : undefined;
  }

  /** Lists the calling customer's orders. */
  async listMine(
    auth: AuthContext,
    opts: ListMyOrdersOptions = {},
  ): Promise<PaginatedItems<Order>> {
    const query: Record<string, string | number | undefined> = {};
    setIfDefined(query, "pageNumber", opts.pageNumber);
    setIfDefined(query, "pageSize", opts.pageSize);
    setIfDefined(query, "status", opts.status);
    setIfDefined(query, "legalEntityId", opts.legalEntityId);
    setIfDefined(query, "siteCode", opts.siteCode);
    const headers = this.saasHeader(opts.saasToken);
    return this.ctx.http.request<PaginatedItems<Order>>({
      method: "GET",
      path: this.base(),
      query,
      auth,
      ...(headers ? { headers } : {}),
    });
  }

  /** Fetches one of the calling customer's orders by id. */
  async get(
    orderId: string,
    auth: AuthContext,
    opts: GetOrderOptions = {},
  ): Promise<Order> {
    const headers = this.saasHeader(opts.saasToken);
    return this.ctx.http.request<Order>({
      method: "GET",
      path: `${this.base()}/${orderId}`,
      auth,
      ...(headers ? { headers } : {}),
    });
  }

  /** Transitions an order to a new status. Server enforces legal transitions. */
  async transition(
    orderId: string,
    status: OrderStatus,
    auth: AuthContext,
    opts: OrderTransitionOptions = {},
  ): Promise<void> {
    const body: { status: OrderStatus; comment?: string } = { status };
    if (opts.comment !== undefined) body.comment = opts.comment;
    const headers = this.saasHeader(opts.saasToken);
    await this.ctx.http.request<void>({
      method: "POST",
      path: `${this.base()}/${orderId}/transitions`,
      auth,
      body,
      ...(headers ? { headers } : {}),
    });
  }

  /** Convenience: transitions to `DECLINED` (customer cancel). */
  async cancel(
    orderId: string,
    auth: AuthContext,
    opts: { saasToken?: string } = {},
  ): Promise<void> {
    await this.transition(orderId, "DECLINED", auth, opts);
  }
}

/**
 * Backend / service-account access to the merchant-facing
 * `/salesorders/{id}` resource. Requires `order.order_read` (read) /
 * `order.order_manage` (update) scopes on a service token.
 *
 * The full admin list + filter surface is deferred to a follow-up
 * sub-spec. This service ships only single-resource read + patch — the
 * common backend use case (e.g. mixin updates after fulfilment).
 */
export class SalesOrdersService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/order-v2/${this.ctx.tenant}/salesorders`;
  }

  /** Fetches a single sales-order by id. */
  async get(orderId: string, auth: AuthContext): Promise<Order> {
    return this.ctx.http.request<Order>({
      method: "GET",
      path: `${this.base()}/${orderId}`,
      auth,
    });
  }

  /** Patches an existing order (status, mixins, customAttributes, metadata). */
  async update(
    orderId: string,
    patch: SalesOrderPatch,
    auth: AuthContext,
    opts: UpdateSalesOrderOptions = {},
  ): Promise<Order> {
    const query: Record<string, string> = {};
    if (opts.recalculate === false) query.recalculate = "false";
    return this.ctx.http.request<Order>({
      method: "PATCH",
      path: `${this.base()}/${orderId}`,
      auth,
      ...(Object.keys(query).length > 0 ? { query } : {}),
      body: patch,
    });
  }
}
