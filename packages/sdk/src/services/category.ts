import type { ClientContext, Page } from "../core/context";
import { paginate } from "../core/context";
import type { AuthContext } from "../core/auth";
import type { Product } from "./product";
import type { Category as GeneratedCategory, CategoryTree } from "../generated/category";

const ANON: AuthContext = { kind: "anonymous" };

/** A category as returned by the Category service (all generated fields). */
export type Category = GeneratedCategory;

/** The category tree as returned by the Category service. */
export type CategoryNode = CategoryTree;

/** Category reads. Default auth: anonymous. */
export class CategoryService {
  constructor(private readonly ctx: ClientContext) {}

  /** Fetches one category by id. */
  async get(categoryId: string, auth: AuthContext = ANON): Promise<Category> {
    return this.ctx.http.request<Category>({
      method: "GET",
      path: `/category/${this.ctx.tenant}/categories/${categoryId}`,
      auth,
    });
  }

  /** One page of categories. */
  async list(
    params: { pageNumber?: number; pageSize?: number } = {},
    auth: AuthContext = ANON,
  ): Promise<Page<Category>> {
    const pageNumber = params.pageNumber ?? 1;
    const pageSize = params.pageSize ?? 50;
    const items = await this.ctx.http.request<Category[]>({
      method: "GET",
      path: `/category/${this.ctx.tenant}/categories`,
      query: { pageNumber, pageSize },
      auth,
    });
    return { items, total: Number.NaN, offset: (pageNumber - 1) * pageSize, limit: pageSize };
  }

  /** Async-iterates every category across pages. */
  listAll(params: { pageSize?: number } = {}, auth: AuthContext = ANON): AsyncIterable<Category> {
    const pageSize = params.pageSize ?? 50;
    return paginate<Category>(async (offset, limit) => {
      const pageNumber = offset / limit + 1;
      const page = await this.list({ pageNumber, pageSize: limit }, auth);
      return { ...page, limit };
    }, pageSize);
  }

  /** Fetches the category tree, optionally rooted at `rootId`. */
  async tree(rootId?: string, auth: AuthContext = ANON): Promise<CategoryNode> {
    return this.ctx.http.request<CategoryNode>({
      method: "GET",
      path: `/category/${this.ctx.tenant}/categories/tree`,
      query: rootId ? { rootId } : {},
      auth,
    });
  }

  /** One page of products in a category. */
  async productsIn(
    categoryId: string,
    params: { pageNumber?: number; pageSize?: number } = {},
    auth: AuthContext = ANON,
  ): Promise<Page<Product>> {
    const pageNumber = params.pageNumber ?? 1;
    const pageSize = params.pageSize ?? 50;
    const items = await this.ctx.http.request<Product[]>({
      method: "GET",
      path: `/category/${this.ctx.tenant}/categories/${categoryId}/products`,
      query: { pageNumber, pageSize },
      auth,
    });
    return { items, total: Number.NaN, offset: (pageNumber - 1) * pageSize, limit: pageSize };
  }

  /**
   * Bulk fetch by id. POSTs `/categories/search` with `q="id:(id1,id2,…)"`,
   * chunking when the list is larger than `options.chunkSize` (default
   * 100). An empty list short-circuits with no HTTP call. **Order is not
   * guaranteed** across chunks — re-index by `id` if order matters.
   */
  async searchByIds(
    ids: string[],
    options: { chunkSize?: number } = {},
    auth: AuthContext = ANON,
  ): Promise<Category[]> {
    if (ids.length === 0) return [];
    const chunkSize = options.chunkSize ?? 100;
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += chunkSize) {
      chunks.push(ids.slice(i, i + chunkSize));
    }
    const pages = await Promise.all(
      chunks.map((chunk) =>
        this.ctx.http.request<Category[]>({
          method: "POST",
          path: `/category/${this.ctx.tenant}/categories/search`,
          query: { pageSize: chunk.length },
          auth,
          body: { q: `id:(${chunk.join(",")})` },
        }),
      ),
    );
    return pages.flat();
  }
}
