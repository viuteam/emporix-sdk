import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type { Catalog, CatalogList, CatalogInput, CatalogUpdate, CatalogPatch, CatalogCreated } from "./catalog-types";

export type { Catalog, CatalogList, CatalogInput, CatalogUpdate, CatalogPatch, CatalogCreated } from "./catalog-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Emporix Catalog Management (`/catalog/{tenant}/catalogs`): CRUD over catalogs.
 * Server-side; defaults to the service token. `updateCatalog` is an upsert (PUT).
 */
export class CatalogService {
  static readonly channel = "catalog" as const;
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/catalog/${this.ctx.tenant}/catalogs`;
  }

  /** List catalogs (filtered/sorted). */
  async listCatalogs(query: Record<string, string | number> = {}, auth: AuthContext = SERVICE): Promise<CatalogList> {
    return this.ctx.http.request<CatalogList>({
      method: "GET",
      path: this.base(),
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Retrieve a catalog by id. */
  async getCatalog(catalogId: string, auth: AuthContext = SERVICE): Promise<Catalog> {
    return this.ctx.http.request<Catalog>({
      method: "GET",
      path: `${this.base()}/${encodeURIComponent(catalogId)}`,
      auth,
    });
  }

  /** Retrieve all catalogs that contain a category. */
  async getCatalogsForCategory(categoryId: string, auth: AuthContext = SERVICE): Promise<CatalogList> {
    return this.ctx.http.request<CatalogList>({
      method: "GET",
      path: `${this.base()}/categories/${encodeURIComponent(categoryId)}`,
      auth,
    });
  }

  /** Create a catalog. */
  async createCatalog(input: CatalogInput, auth: AuthContext = SERVICE): Promise<CatalogCreated> {
    return this.ctx.http.request<CatalogCreated>({ method: "POST", path: this.base(), auth, body: input });
  }

  /** Upsert a catalog by id (`PUT`). */
  async updateCatalog(catalogId: string, input: CatalogUpdate, auth: AuthContext = SERVICE): Promise<CatalogCreated> {
    return this.ctx.http.request<CatalogCreated>({
      method: "PUT",
      path: `${this.base()}/${encodeURIComponent(catalogId)}`,
      auth,
      body: input,
    });
  }

  /** Partially update a catalog by id (`PATCH`). */
  async patchCatalog(catalogId: string, patch: CatalogPatch, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PATCH",
      path: `${this.base()}/${encodeURIComponent(catalogId)}`,
      auth,
      body: patch,
    });
  }

  /** Remove a catalog by id. */
  async deleteCatalog(catalogId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/${encodeURIComponent(catalogId)}`,
      auth,
    });
  }
}
