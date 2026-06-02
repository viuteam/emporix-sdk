/**
 * Public types for the Vendor Service — stable names aliased over the generated
 * `vendor-service` types. Vendor "locations" are the vendor's own pickup/
 * warehouse locations, distinct from the customer-management `client.locations`.
 */
import type {
  Vendor as GenVendor,
  VendorCreate,
  VendorUpdate as GenVendorUpdate,
  Location as GenLocation,
  LocationCreate,
  LocationUpdate,
  ResourceId,
} from "../generated/vendor-service";

/** A vendor (read shape). */
export type Vendor = GenVendor;
/** List of vendors. */
export type VendorList = Vendor[];
/** Create body (`POST /vendors`). */
export type VendorInput = VendorCreate;
/** Upsert body (`PUT /vendors/{id}`). */
export type VendorUpdate = GenVendorUpdate;
/** Create response — a resource id. */
export type VendorCreated = ResourceId;
/** Search body (`POST /vendors/search`). */
export type VendorSearchQuery = Record<string, unknown>;

/** A vendor location (read shape). */
export type VendorLocation = GenLocation;
/** List of vendor locations. */
export type VendorLocationList = VendorLocation[];
/** Create body (`POST /locations`). */
export type VendorLocationInput = LocationCreate;
/** Upsert body (`PUT /locations/{id}`). */
export type VendorLocationUpdate = LocationUpdate;
