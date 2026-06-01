/**
 * Public types for the Unit Handling Service — stable names aliased over the
 * generated `unit-handling-service` types.
 */
import type {
  Unit as GenUnit,
  BaseUnit,
  UpdateUnit,
  CreateUnitResponse,
  ConversionFactorPayload,
  ConversionFactorResponse,
  ConversionPayload,
  ConversionResponse,
} from "../generated/unit-handling-service";

/** A unit (read shape). */
export type Unit = GenUnit;
/** Create body (`POST /units`). */
export type UnitInput = BaseUnit;
/** Update body (`PUT /units/{code}`). */
export type UnitUpdate = UpdateUnit;
/** `POST /units` response. */
export type UnitCreated = CreateUnitResponse;
/** Body for `getConversionFactor`. */
export type ConversionFactorInput = ConversionFactorPayload;
/** Result of `getConversionFactor`. */
export type ConversionFactorResult = ConversionFactorResponse;
/** Body for `convertUnit`. */
export type ConvertUnitInput = ConversionPayload;
/** Result of `convertUnit`. */
export type ConvertUnitResult = ConversionResponse;
