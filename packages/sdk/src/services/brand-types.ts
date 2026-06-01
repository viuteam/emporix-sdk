/**
 * Public types for the Brand Service — stable names aliased over the generated
 * `brand-service` types.
 */
import type {
  BrandResponse,
  Brands,
  Brand as GenBrandInput,
  UpdateBrand,
} from "../generated/brand-service";

/** A brand (read shape). */
export type Brand = BrandResponse;
/** List of brands (`GET /brand/brands`) — a plain array. */
export type BrandList = Brands;
/** Create body (`POST /brand/brands`). */
export type BrandInput = GenBrandInput;
/** Update / patch body (`PUT` / `PATCH /brand/brands/{id}`). */
export type BrandUpdate = UpdateBrand;
