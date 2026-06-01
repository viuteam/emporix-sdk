import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  Unit,
  UnitInput,
  UnitUpdate,
  UnitCreated,
  ConversionFactorInput,
  ConversionFactorResult,
  ConvertUnitInput,
  ConvertUnitResult,
} from "./unit-handling-types";

export type {
  Unit,
  UnitInput,
  UnitUpdate,
  UnitCreated,
  ConversionFactorInput,
  ConversionFactorResult,
  ConvertUnitInput,
  ConvertUnitResult,
} from "./unit-handling-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Emporix Unit Handling Service (`/unit-handling/{tenant}/…`): units CRUD, unit
 * types, and conversion commands. Server-side; defaults to the service token.
 */
export class UnitHandlingService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/unit-handling/${this.ctx.tenant}`;
  }

  /** Find units (filter/sort/page). */
  async listUnits(query: Record<string, string | number> = {}, auth: AuthContext = SERVICE): Promise<Unit[]> {
    return this.ctx.http.request<Unit[]>({
      method: "GET",
      path: `${this.base()}/units`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Retrieve a unit by code. */
  async getUnit(unitCode: string, auth: AuthContext = SERVICE): Promise<Unit> {
    return this.ctx.http.request<Unit>({
      method: "GET",
      path: `${this.base()}/units/${encodeURIComponent(unitCode)}`,
      auth,
    });
  }

  /** Add a new unit. */
  async createUnit(input: UnitInput, auth: AuthContext = SERVICE): Promise<UnitCreated> {
    return this.ctx.http.request<UnitCreated>({ method: "POST", path: `${this.base()}/units`, auth, body: input });
  }

  /** Update a unit by code. */
  async updateUnit(unitCode: string, input: UnitUpdate, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `${this.base()}/units/${encodeURIComponent(unitCode)}`,
      auth,
      body: input,
    });
  }

  /** Delete a unit by code. */
  async deleteUnit(unitCode: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/units/${encodeURIComponent(unitCode)}`,
      auth,
    });
  }

  /** Delete multiple units by code (bulk). The codes are sent as the request body. */
  async deleteUnits(codes: string[], auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/units`,
      auth,
      body: codes,
    });
  }

  /** Fetch a conversion factor (`PUT /units/conversion-factor-commands`). */
  async getConversionFactor(input: ConversionFactorInput, auth: AuthContext = SERVICE): Promise<ConversionFactorResult> {
    return this.ctx.http.request<ConversionFactorResult>({
      method: "PUT",
      path: `${this.base()}/units/conversion-factor-commands`,
      auth,
      body: input,
    });
  }

  /** Convert a value between units (`PUT /units/convert-unit-commands`). */
  async convertUnit(input: ConvertUnitInput, auth: AuthContext = SERVICE): Promise<ConvertUnitResult> {
    return this.ctx.http.request<ConvertUnitResult>({
      method: "PUT",
      path: `${this.base()}/units/convert-unit-commands`,
      auth,
      body: input,
    });
  }

  /** List all unit types. */
  async listUnitTypes(auth: AuthContext = SERVICE): Promise<string[]> {
    return this.ctx.http.request<string[]>({ method: "GET", path: `${this.base()}/types`, auth });
  }
}
