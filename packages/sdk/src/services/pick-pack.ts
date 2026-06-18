import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  PickOrder,
  PickOrderList,
  OrderStatusChange,
  PackagingProductsChange,
  Assignee,
  OrderEntryEventCreate,
  PackingEventList,
  OrderCycleList,
  RecalculationJobInput,
  RecalculationJob,
  PickPackAck,
  RecalculationJobCreated,
} from "./pick-pack-types";

export type {
  PickOrder,
  PickOrderList,
  OrderStatusChange,
  PackagingProductsChange,
  Assignee,
  OrderEntryEventCreate,
  PackingEvent,
  PackingEventList,
  OrderCycleList,
  RecalculationJobInput,
  RecalculationJob,
  PickPackAck,
  RecalculationJobCreated,
} from "./pick-pack-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Emporix Pick-Pack Service (`/pick-pack/{tenant}/…`): fulfillment/packlist
 * orders, assignees, packaging, packing events, and recalculation jobs.
 * Server-side; defaults to the service token. Several mutating endpoints return
 * an acknowledgement (`{ message?, code? }`).
 *
 * @deprecated since 2026-05-25, removal 2026-08-24 — the Pick-Pack service is
 * being sunset by Emporix; all endpoints are no longer maintained.
 */
export class PickPackService {
  static readonly channel = "pick-pack" as const;
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/pick-pack/${this.ctx.tenant}`;
  }

  private orderPath(orderId: string): string {
    return `${this.base()}/orders/${encodeURIComponent(orderId)}`;
  }

  /** List packlist orders. */
  async listOrders(query: Record<string, string | number> = {}, auth: AuthContext = SERVICE): Promise<PickOrderList> {
    return this.ctx.http.request<PickOrderList>({
      method: "GET",
      path: `${this.base()}/orders`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Retrieve a packlist order by id. */
  async getOrder(orderId: string, auth: AuthContext = SERVICE): Promise<PickOrder> {
    return this.ctx.http.request<PickOrder>({ method: "GET", path: this.orderPath(orderId), auth });
  }

  /** Update an order's status (`PATCH`). Returns an acknowledgement. */
  async updateOrder(orderId: string, change: OrderStatusChange, auth: AuthContext = SERVICE): Promise<PickPackAck> {
    return this.ctx.http.request<PickPackAck>({ method: "PATCH", path: this.orderPath(orderId), auth, body: change });
  }

  /** Finish an order. Returns an acknowledgement. */
  async finishOrder(orderId: string, auth: AuthContext = SERVICE): Promise<PickPackAck> {
    return this.ctx.http.request<PickPackAck>({ method: "POST", path: `${this.orderPath(orderId)}/finish`, auth });
  }

  /** List order cycles (ids). */
  async listOrderCycles(query: Record<string, string | number> = {}, auth: AuthContext = SERVICE): Promise<OrderCycleList> {
    return this.ctx.http.request<OrderCycleList>({
      method: "GET",
      path: `${this.base()}/orderCycles`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Add an assignee to an order. Returns an acknowledgement. */
  async addAssignee(orderId: string, assignee: Assignee, auth: AuthContext = SERVICE): Promise<PickPackAck> {
    return this.ctx.http.request<PickPackAck>({ method: "POST", path: `${this.orderPath(orderId)}/assignees`, auth, body: assignee });
  }

  /** Remove an assignee from an order. */
  async removeAssignee(orderId: string, assigneeId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.orderPath(orderId)}/assignees/${encodeURIComponent(assigneeId)}`,
      auth,
    });
  }

  /** Update packaging products for an order (`PUT`). Returns an acknowledgement. */
  async updatePackaging(orderId: string, change: PackagingProductsChange, auth: AuthContext = SERVICE): Promise<PickPackAck> {
    return this.ctx.http.request<PickPackAck>({ method: "PUT", path: `${this.orderPath(orderId)}/packaging`, auth, body: change });
  }

  /** Create a packing event. Returns an acknowledgement. */
  async createEvent(event: OrderEntryEventCreate, auth: AuthContext = SERVICE): Promise<PickPackAck> {
    return this.ctx.http.request<PickPackAck>({ method: "POST", path: `${this.base()}/events`, auth, body: event });
  }

  /** List packing events. */
  async listEvents(query: Record<string, string | number> = {}, auth: AuthContext = SERVICE): Promise<PackingEventList> {
    return this.ctx.http.request<PackingEventList>({
      method: "GET",
      path: `${this.base()}/events`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Trigger an order recalculation. Returns the created job's id. */
  async triggerRecalculation(input: RecalculationJobInput, auth: AuthContext = SERVICE): Promise<RecalculationJobCreated> {
    return this.ctx.http.request<RecalculationJobCreated>({
      method: "POST",
      path: `${this.base()}/jobs/recalculations`,
      auth,
      body: input,
    });
  }

  /** Retrieve a recalculation job by id. */
  async getRecalculationJob(jobId: string, auth: AuthContext = SERVICE): Promise<RecalculationJob> {
    return this.ctx.http.request<RecalculationJob>({
      method: "GET",
      path: `${this.base()}/jobs/recalculations/${encodeURIComponent(jobId)}`,
      auth,
    });
  }
}
