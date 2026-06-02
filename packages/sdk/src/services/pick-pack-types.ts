/**
 * Public types for the Pick-Pack Service — stable names aliased over the
 * generated `pick-pack` types. Several mutating endpoints return an inline
 * acknowledgement (`{ message?, code? }`) rather than the resource.
 */
import type {
  Order as GenOrder,
  OrderList,
  Assignee as GenAssignee,
  OrderEntryEventResponse,
  RecalculationJobCreation,
  RecalculationJob as GenRecalculationJob,
} from "../generated/pick-pack";

/** Bodies re-exported with their generated names. */
export type {
  OrderStatusChange,
  PackagingProductsChange,
  OrderEntryEventCreate,
} from "../generated/pick-pack";

/** A pick-pack (fulfillment) order — single read shape. */
export type PickOrder = GenOrder;
/** Packlist — list of pick-pack order summaries (`GET /orders`). */
export type PickOrderList = OrderList[];
/** An order assignee. */
export type Assignee = GenAssignee;
/** A packing event (read). */
export type PackingEvent = OrderEntryEventResponse;
/** List of packing events. */
export type PackingEventList = PackingEvent[];
/** Order cycles (`GET /orderCycles`) — a list of ids. */
export type OrderCycleList = string[];
/** Body for `triggerRecalculation`. */
export type RecalculationJobInput = RecalculationJobCreation;
/** A recalculation job (read). */
export type RecalculationJob = GenRecalculationJob;

/** Inline acknowledgement returned by several mutating endpoints. */
export interface PickPackAck {
  message?: string;
  code?: number;
}
/** `triggerRecalculation` response — the created job's id. */
export interface RecalculationJobCreated {
  jobId?: string;
}
