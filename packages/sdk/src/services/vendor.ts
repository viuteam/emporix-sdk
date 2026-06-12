import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  Vendor,
  VendorList,
  VendorInput,
  VendorUpdate,
  VendorCreated,
  VendorSearchQuery,
  VendorLocation,
  VendorLocationList,
  VendorLocationInput,
  VendorLocationUpdate,
} from "./vendor-types";

export type {
  Vendor,
  VendorList,
  VendorInput,
  VendorUpdate,
  VendorCreated,
  VendorSearchQuery,
  VendorLocation,
  VendorLocationList,
  VendorLocationInput,
  VendorLocationUpdate,
} from "./vendor-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Emporix Vendor Service (`/vendor/{tenant}/…`): vendors and their locations.
 * Server-side; defaults to the service token. PUT methods are upserts. Vendor
 * locations are the vendor's own pickup/warehouse locations (distinct from the
 * customer-management `client.locations`).
 */
export class VendorService {
  static readonly channel = "vendor" as const;
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/vendor/${this.ctx.tenant}`;
  }

  // --- Vendors ---

  /** List all vendors. */
  async listVendors(query: Record<string, string | number> = {}, auth: AuthContext = SERVICE): Promise<VendorList> {
    return this.ctx.http.request<VendorList>({
      method: "GET",
      path: `${this.base()}/vendors`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Retrieve a vendor by id. */
  async getVendor(vendorId: string, auth: AuthContext = SERVICE): Promise<Vendor> {
    return this.ctx.http.request<Vendor>({
      method: "GET",
      path: `${this.base()}/vendors/${encodeURIComponent(vendorId)}`,
      auth,
    });
  }

  /** Search vendors (`POST /vendors/search`). */
  async searchVendors(query: VendorSearchQuery, auth: AuthContext = SERVICE): Promise<VendorList> {
    return this.ctx.http.request<VendorList>({
      method: "POST",
      path: `${this.base()}/vendors/search`,
      auth,
      body: query,
    });
  }

  /** Create a vendor. */
  async createVendor(input: VendorInput, auth: AuthContext = SERVICE): Promise<VendorCreated> {
    return this.ctx.http.request<VendorCreated>({ method: "POST", path: `${this.base()}/vendors`, auth, body: input });
  }

  /** Upsert a vendor by id (`PUT`). */
  async updateVendor(vendorId: string, input: VendorUpdate, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `${this.base()}/vendors/${encodeURIComponent(vendorId)}`,
      auth,
      body: input,
    });
  }

  /** Delete a vendor by id. */
  async deleteVendor(vendorId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/vendors/${encodeURIComponent(vendorId)}`,
      auth,
    });
  }

  // --- Vendor locations ---

  /** List all vendor locations. */
  async listVendorLocations(query: Record<string, string | number> = {}, auth: AuthContext = SERVICE): Promise<VendorLocationList> {
    return this.ctx.http.request<VendorLocationList>({
      method: "GET",
      path: `${this.base()}/locations`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Retrieve a vendor location by id. */
  async getVendorLocation(locationId: string, auth: AuthContext = SERVICE): Promise<VendorLocation> {
    return this.ctx.http.request<VendorLocation>({
      method: "GET",
      path: `${this.base()}/locations/${encodeURIComponent(locationId)}`,
      auth,
    });
  }

  /** Create a vendor location. */
  async createVendorLocation(input: VendorLocationInput, auth: AuthContext = SERVICE): Promise<VendorCreated> {
    return this.ctx.http.request<VendorCreated>({ method: "POST", path: `${this.base()}/locations`, auth, body: input });
  }

  /** Upsert a vendor location by id (`PUT`). */
  async updateVendorLocation(locationId: string, input: VendorLocationUpdate, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `${this.base()}/locations/${encodeURIComponent(locationId)}`,
      auth,
      body: input,
    });
  }

  /** Delete a vendor location by id. */
  async deleteVendorLocation(locationId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/locations/${encodeURIComponent(locationId)}`,
      auth,
    });
  }
}
