/**
 * Public types for the Catalog Management Service — stable names aliased over
 * the generated `catalog` types.
 */
import type {
  Catalog as GenCatalog,
  CreateCatalog,
  UpdateCatalog,
  UpdateCatalogProperties,
  CreateCatalogResponse,
} from "../generated/catalog";

/** A catalog (read shape). */
export type Catalog = GenCatalog;
/** List of catalogs. */
export type CatalogList = Catalog[];
/** Create body (`POST /catalogs`). */
export type CatalogInput = CreateCatalog;
/** Upsert body (`PUT /catalogs/{id}`). */
export type CatalogUpdate = UpdateCatalog;
/** Partial-update body (`PATCH /catalogs/{id}`). */
export type CatalogPatch = UpdateCatalogProperties;
/** Create / upsert response (the created catalog's id). */
export type CatalogCreated = CreateCatalogResponse;
