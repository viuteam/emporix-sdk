/**
 * Public types for the Returns Service — stable names aliased over the generated
 * `returns` types. `Return` is the read shape (customer/employee variant union).
 * The list endpoint is typed as a single return upstream (spec inaccuracy); it
 * actually returns an array, so `ReturnList` overrides to `Return[]`.
 */
import type {
  FullCustomerReturn,
  FullEmployeeReturn,
  ReturnCreateBody,
  ReturnUpdateBody,
  PatchOperation,
  ReturnId,
} from "../generated/returns";

/** A return (read shape) — customer or employee variant. */
export type Return = FullCustomerReturn | FullEmployeeReturn;
/** List of returns (`GET /returns`, paged). */
export type ReturnList = Return[];
/** Create body (`POST /returns`). */
export type ReturnInput = ReturnCreateBody;
/** Replace body (`PUT /returns/{id}`). */
export type ReturnUpdate = ReturnUpdateBody;
/** Partial-update body (`PATCH /returns/{id}`) — a JSON-Patch op-array. */
export type ReturnPatch = PatchOperation[];
/** `POST /returns` response — the created return's `{ id }`. */
export type ReturnCreated = ReturnId;
