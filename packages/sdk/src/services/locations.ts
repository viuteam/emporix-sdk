import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  Location,
  LocationCreate,
  LocationUpdate,
} from "../generated/customer-management";

/**
 * Manages locations owned by a legal entity. Three types are supported:
 * HEADQUARTER, WAREHOUSE, OFFICE.
 *
 * Reads require `customermanagement.location_read`; mutations require
 * `_manage`.
 */
export class LocationsService {
  static readonly channel = "customer-management" as const;
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/customer-management/${this.ctx.tenant}/locations`;
  }

  /** Lists locations owned by one legal entity. */
  async listForCompany(legalEntityId: string, auth: AuthContext): Promise<Location[]> {
    return this.ctx.http.request<Location[]>({
      method: "GET",
      path: this.base(),
      query: { legalEntityId },
      auth,
    });
  }

  /** Fetches one location by id. */
  async get(locationId: string, auth: AuthContext): Promise<Location> {
    return this.ctx.http.request<Location>({
      method: "GET",
      path: `${this.base()}/${locationId}`,
      auth,
    });
  }

  /** Creates a location for a legal entity. */
  async create(input: LocationCreate, auth: AuthContext): Promise<{ id: string }> {
    return this.ctx.http.request<{ id: string }>({
      method: "POST",
      path: this.base(),
      auth,
      body: input,
    });
  }

  /**
   * Updates a location via `PUT …/locations/{id}` (upsert / full replace). The
   * live API rejects `PATCH` on this path with 405; send the complete entity,
   * as the server replaces the resource. The body stays typed as a partial of
   * `LocationUpdate` for backward compatibility.
   */
  async update(
    locationId: string,
    patch: Partial<LocationUpdate>,
    auth: AuthContext,
  ): Promise<Location> {
    return this.ctx.http.request<Location>({
      method: "PUT",
      path: `${this.base()}/${locationId}`,
      auth,
      body: patch,
    });
  }

  /** Deletes a location. */
  async delete(locationId: string, auth: AuthContext): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/${locationId}`,
      auth,
    });
  }
}
