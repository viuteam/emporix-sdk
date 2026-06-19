/**
 * Public types for the Availability Service — stable names aliased over the
 * generated `availability` types. The single-product GET and the batch search
 * both return the bundle-aware variant; there is no restock-date field.
 *
 * Note: only the availability *location-management* endpoints are deprecated
 * upstream (removal 2026-09-01); the SDK does not wrap those. The product
 * availability endpoints used here are current.
 */
import type { AvailabilityWithBundle } from "../generated/availability";

/** A product's availability record (bundle-aware). */
export type Availability = AvailabilityWithBundle;
