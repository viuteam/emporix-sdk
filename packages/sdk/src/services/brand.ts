import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type { Brand, BrandList, BrandInput, BrandUpdate } from "./brand-types";

export type { Brand, BrandList, BrandInput, BrandUpdate } from "./brand-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Emporix Brand Service (`/brand/brands`): CRUD over brands. Server-side;
 * defaults to the service token (reads also work with an anonymous token).
 * The path carries no `{tenant}` segment — the tenant comes from the token.
 */
export class BrandService {
  static readonly channel = "brand" as const;
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/brand/brands`;
  }

  /** List all brands. */
  async listBrands(
    query: Record<string, string | number> = {},
    auth: AuthContext = SERVICE,
  ): Promise<BrandList> {
    return this.ctx.http.request<BrandList>({
      method: "GET",
      path: this.base(),
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Retrieve one brand by id. */
  async getBrand(brandId: string, auth: AuthContext = SERVICE): Promise<Brand> {
    return this.ctx.http.request<Brand>({
      method: "GET",
      path: `${this.base()}/${encodeURIComponent(brandId)}`,
      auth,
    });
  }

  /** Create a brand. */
  async createBrand(input: BrandInput, auth: AuthContext = SERVICE): Promise<Brand> {
    return this.ctx.http.request<Brand>({
      method: "POST",
      path: this.base(),
      auth,
      body: input,
    });
  }

  /** Replace a brand by id. */
  async updateBrand(brandId: string, input: BrandUpdate, auth: AuthContext = SERVICE): Promise<Brand> {
    return this.ctx.http.request<Brand>({
      method: "PUT",
      path: `${this.base()}/${encodeURIComponent(brandId)}`,
      auth,
      body: input,
    });
  }

  /** Partially update a brand by id. */
  async patchBrand(brandId: string, patch: BrandUpdate, auth: AuthContext = SERVICE): Promise<Brand> {
    return this.ctx.http.request<Brand>({
      method: "PATCH",
      path: `${this.base()}/${encodeURIComponent(brandId)}`,
      auth,
      body: patch,
    });
  }

  /** Delete a brand by id. */
  async deleteBrand(brandId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/${encodeURIComponent(brandId)}`,
      auth,
    });
  }
}
