/**
 * Public types for the Availability Service — stable names aliased over the
 * generated `availability` types. The single-product GET and the batch search
 * both return the bundle-aware variant; there is no restock-date field.
 *
 * Note: only the availability *location-management* endpoints are deprecated
 * upstream (removal 2026-09-01); the SDK does not wrap those. The product
 * availability endpoints used here are current.
 */
import type {
  AvailabilityWithBundle,
  AvailabilityDto,
  AvailabilityBulkDto,
  AvailabilityDeleteBulkDto,
  IdResponse,
  BulkResponse,
} from "../generated/availability";

/** A product's availability record (bundle-aware). */
export type Availability = AvailabilityWithBundle;

/** Body for creating or updating a single product's availability. */
export type AvailabilityInput = AvailabilityDto;

/** Id envelope returned when an availability record is created. */
export type AvailabilityCreated = IdResponse;

/** One entry of a bulk create/update request. */
export type AvailabilityBulkInput = AvailabilityBulkDto;

/** One entry of a bulk delete request. */
export type AvailabilityBulkDeleteInput = AvailabilityDeleteBulkDto;

/** Per-entry result of a bulk availability operation (207 Multi-Status). */
export type AvailabilityBulkResult = BulkResponse;
