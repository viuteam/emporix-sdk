/**
 * Public types for the Tax Service — stable names re-exported over the
 * generated `tax-service` types. The only refinements are narrowing the
 * always-present read fields (`locationCode`, `taxClasses`) from the loosely
 * optional generated shape; everything else aliases the generated types so the
 * codegen stays the single source of truth.
 */
import type {
  TaxClass,
  Location,
  TaxRetrieval,
  TaxCreationResponse,
  TaxCalculationRequest,
  TaxCalculationResponse,
} from "../generated/tax-service";

export type {
  /** One tax class within a configuration (`code`, `name`, `rate`, …). */
  TaxClass,
  /** Create body (`POST /taxes`). */
  TaxCreation as TaxConfigInput,
  /** Update body (`PUT /taxes/{locationCode}`) — requires `metadata.version`. */
  TaxUpdate as TaxConfigUpdate,
  /** Body for `calculateTax` (`{ commandUuid?, input }`). */
  TaxCalculationRequest,
} from "../generated/tax-service";

/** A country/location reference (`{ countryCode }`). */
export type TaxLocation = Location;

/**
 * A per-location tax configuration (read shape — `GET /taxes` /
 * `/taxes/{locationCode}`). Built on the generated `TaxRetrieval`, with
 * `locationCode` and `taxClasses` narrowed to required (a persisted
 * configuration always carries both).
 */
export type TaxConfig = Omit<TaxRetrieval, "locationCode" | "taxClasses"> & {
  locationCode: string;
  taxClasses: TaxClass[];
};

/** `POST /taxes` response — only the created `{ locationCode }`. */
export type TaxConfigCreated = Required<TaxCreationResponse>;

/** Calculation command input (the `input` member of the request). */
export type TaxCalculationInput = TaxCalculationRequest["input"];

/** Result of `calculateTax` — `output` carries `netPrice` / `grossPrice` / `*TaxRate`. */
export type TaxCalculationResult = TaxCalculationResponse;
