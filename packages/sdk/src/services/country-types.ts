/**
 * Public types for the Country Service — stable names aliased over the generated
 * `country-service` types. The list endpoints return plain arrays upstream.
 */
import type {
  Country as GenCountry,
  Region as GenRegion,
  CountryUpdate as GenCountryUpdate,
} from "../generated/country-service";

/** A country (read shape). */
export type Country = GenCountry;
/** List of countries (`GET /countries`) — a plain array. */
export type CountryList = Country[];
/** PATCH body for a country. */
export type CountryUpdate = GenCountryUpdate;
/** A region (read shape). */
export type Region = GenRegion;
/** List of regions (`GET /regions`) — a plain array. */
export type RegionList = Region[];
