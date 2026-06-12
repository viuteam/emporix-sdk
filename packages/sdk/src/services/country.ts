import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type { Country, CountryList, CountryUpdate, Region, RegionList } from "./country-types";

export type { Country, CountryList, CountryUpdate, Region, RegionList } from "./country-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Emporix Country Service (`/country/{tenant}/…`): countries and regions
 * master data. Server-side; defaults to the service token (reads also work
 * with an anonymous token). Countries are predefined — list/get/patch only
 * (no create/delete).
 */
export class CountryService {
  static readonly channel = "country" as const;
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/country/${this.ctx.tenant}`;
  }

  /** List all countries. */
  async listCountries(
    query: Record<string, string | number> = {},
    auth: AuthContext = SERVICE,
  ): Promise<CountryList> {
    return this.ctx.http.request<CountryList>({
      method: "GET",
      path: `${this.base()}/countries`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Retrieve one country by code. */
  async getCountry(countryCode: string, auth: AuthContext = SERVICE): Promise<Country> {
    return this.ctx.http.request<Country>({
      method: "GET",
      path: `${this.base()}/countries/${encodeURIComponent(countryCode)}`,
      auth,
    });
  }

  /** Partially update a country by code. Resolves once accepted (no response body). */
  async patchCountry(countryCode: string, patch: CountryUpdate, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PATCH",
      path: `${this.base()}/countries/${encodeURIComponent(countryCode)}`,
      auth,
      body: patch,
    });
  }

  /** List all regions. */
  async listRegions(
    query: Record<string, string | number> = {},
    auth: AuthContext = SERVICE,
  ): Promise<RegionList> {
    return this.ctx.http.request<RegionList>({
      method: "GET",
      path: `${this.base()}/regions`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Retrieve one region by code. */
  async getRegion(regionCode: string, auth: AuthContext = SERVICE): Promise<Region> {
    return this.ctx.http.request<Region>({
      method: "GET",
      path: `${this.base()}/regions/${encodeURIComponent(regionCode)}`,
      auth,
    });
  }
}
