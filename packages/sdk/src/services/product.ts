import type { ClientContext, Page } from "../core/context";
import { paginate } from "../core/context";
import type { AuthContext } from "../core/auth";

const ANON: AuthContext = { kind: "anonymous" };

/** A product (subset; full type comes from generated specs). */
export interface Product {
  id: string;
  name?: string;
  code?: string;
  [k: string]: unknown;
}

/** A product media entry. */
export interface Media {
  id: string;
  url?: string;
  [k: string]: unknown;
}

/** Catalog reads. Default auth: anonymous; pass customer for personalized pricing. */
export class ProductService {
  constructor(private readonly ctx: ClientContext) {}

  /** Fetches one product by id. */
  async get(
    productId: string,
    _opts?: Record<string, never>,
    auth: AuthContext = ANON,
  ): Promise<Product> {
    return this.ctx.http.request<Product>({
      method: "GET",
      path: `/product/${this.ctx.tenant}/products/${productId}`,
      auth,
    });
  }

  /** Fetches one product by its code. */
  async getByCode(code: string, auth: AuthContext = ANON): Promise<Product> {
    const rows = await this.ctx.http.request<Product[]>({
      method: "GET",
      path: `/product/${this.ctx.tenant}/products`,
      query: { q: `code:${code}` },
      auth,
    });
    const first = rows[0];
    if (!first) throw new Error(`No product with code "${code}"`);
    return first;
  }

  /** One page of products. */
  async list(
    params: { pageNumber?: number; pageSize?: number } = {},
    auth: AuthContext = ANON,
  ): Promise<Page<Product>> {
    const pageNumber = params.pageNumber ?? 1;
    const pageSize = params.pageSize ?? 50;
    const items = await this.ctx.http.request<Product[]>({
      method: "GET",
      path: `/product/${this.ctx.tenant}/products`,
      query: { pageNumber, pageSize },
      auth,
    });
    return { items, total: Number.NaN, offset: (pageNumber - 1) * pageSize, limit: pageSize };
  }

  /** Async-iterates every product across pages. */
  listAll(params: { pageSize?: number } = {}, auth: AuthContext = ANON): AsyncIterable<Product> {
    const pageSize = params.pageSize ?? 50;
    return paginate<Product>(async (offset, limit) => {
      const pageNumber = offset / limit + 1;
      const page = await this.list({ pageNumber, pageSize: limit }, auth);
      return { ...page, limit };
    }, pageSize);
  }

  /** Searches products by free-text query. */
  async search(
    query: string,
    params: { pageNumber?: number; pageSize?: number } = {},
    auth: AuthContext = ANON,
  ): Promise<Page<Product>> {
    const pageNumber = params.pageNumber ?? 1;
    const pageSize = params.pageSize ?? 50;
    const items = await this.ctx.http.request<Product[]>({
      method: "GET",
      path: `/product/${this.ctx.tenant}/products`,
      query: { q: query, pageNumber, pageSize },
      auth,
    });
    return { items, total: Number.NaN, offset: (pageNumber - 1) * pageSize, limit: pageSize };
  }

  /** Media sub-resource. */
  readonly media = {
    list: async (productId: string, auth: AuthContext = ANON): Promise<Media[]> =>
      this.ctx.http.request<Media[]>({
        method: "GET",
        path: `/product/${this.ctx.tenant}/products/${productId}/media`,
        auth,
      }),
  };
}
