import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  TaxConfig,
  TaxConfigInput,
  TaxConfigUpdate,
  TaxConfigCreated,
  TaxCalculationRequest,
  TaxCalculationResult,
} from "./tax-types";

export type {
  TaxClass,
  TaxLocation,
  TaxConfig,
  TaxConfigInput,
  TaxConfigUpdate,
  TaxConfigCreated,
  TaxCalculationInput,
  TaxCalculationRequest,
  TaxCalculationResult,
} from "./tax-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Emporix Tax Service (`/tax/{tenant}/…`): CRUD over per-location tax
 * configurations and the net/gross tax-calculation command. Every endpoint
 * requires a backend `tax.tax_read` / `tax.tax_manage` scope and the
 * **service (clientCredentials) token** — default auth: service.
 *
 * Server-side use only; the service token must never reach a browser.
 */
export class TaxService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/tax/${this.ctx.tenant}`;
  }

  /** List all per-location tax configurations. */
  async listTaxConfigs(auth: AuthContext = SERVICE): Promise<TaxConfig[]> {
    return this.ctx.http.request<TaxConfig[]>({
      method: "GET",
      path: `${this.base()}/taxes`,
      auth,
    });
  }

  /** Retrieve one tax configuration by its location (country) code. */
  async getTaxConfig(locationCode: string, auth: AuthContext = SERVICE): Promise<TaxConfig> {
    return this.ctx.http.request<TaxConfig>({
      method: "GET",
      path: `${this.base()}/taxes/${encodeURIComponent(locationCode)}`,
      auth,
    });
  }

  /** Create a tax configuration (`POST`). Returns the created `{ locationCode }`. */
  async createTaxConfig(
    input: TaxConfigInput,
    auth: AuthContext = SERVICE,
  ): Promise<TaxConfigCreated> {
    return this.ctx.http.request<TaxConfigCreated>({
      method: "POST",
      path: `${this.base()}/taxes`,
      auth,
      body: input,
    });
  }

  /**
   * Update a tax configuration by location code (`PUT`). `metadata.version` is
   * required (optimistic locking — a stale version yields 409).
   */
  async updateTaxConfig(
    locationCode: string,
    input: TaxConfigUpdate,
    auth: AuthContext = SERVICE,
  ): Promise<TaxConfig> {
    return this.ctx.http.request<TaxConfig>({
      method: "PUT",
      path: `${this.base()}/taxes/${encodeURIComponent(locationCode)}`,
      auth,
      body: input,
    });
  }

  /** Delete a tax configuration by location code. */
  async deleteTaxConfig(locationCode: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/taxes/${encodeURIComponent(locationCode)}`,
      auth,
    });
  }

  /**
   * Calculate net/gross values for a price (`PUT /taxes/calculation-commands`).
   * Single command in, single result out.
   */
  async calculateTax(
    request: TaxCalculationRequest,
    auth: AuthContext = SERVICE,
  ): Promise<TaxCalculationResult> {
    return this.ctx.http.request<TaxCalculationResult>({
      method: "PUT",
      path: `${this.base()}/taxes/calculation-commands`,
      auth,
      body: request,
    });
  }
}
