import type { ClientContext, PaginatedItems } from "../core/context";
import { iterateAll } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  BasicProductWithId,
  BundleProductWithId,
  ParentVariantProductWithId,
  ProductMedia,
} from "../generated/product";

const ANON: AuthContext = { kind: "anonymous" };

/** A product as returned by the Product service (all generated fields). */
export type Product = BasicProductWithId | BundleProductWithId | ParentVariantProductWithId;

/** A single product media entry (generated; `ProductMedia` is the list type). */
export type Media = ProductMedia[number];

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
  ): Promise<PaginatedItems<Product>> {
    const pageNumber = params.pageNumber ?? 1;
    const pageSize = params.pageSize ?? 50;
    const items = await this.ctx.http.request<Product[]>({
      method: "GET",
      path: `/product/${this.ctx.tenant}/products`,
      query: { pageNumber, pageSize },
      auth,
    });
    return { items, pageNumber, pageSize, hasNextPage: items.length === pageSize };
  }

  /** Async-iterates every product across pages. */
  listAll(params: { pageSize?: number } = {}, auth: AuthContext = ANON): AsyncIterable<Product> {
    const pageSize = params.pageSize ?? 50;
    return iterateAll<Product>((pageNumber) => this.list({ pageNumber, pageSize }, auth));
  }

  /** Searches products by free-text query. */
  async search(
    query: string,
    params: { pageNumber?: number; pageSize?: number } = {},
    auth: AuthContext = ANON,
  ): Promise<PaginatedItems<Product>> {
    const pageNumber = params.pageNumber ?? 1;
    const pageSize = params.pageSize ?? 50;
    const items = await this.ctx.http.request<Product[]>({
      method: "GET",
      path: `/product/${this.ctx.tenant}/products`,
      query: { q: query, pageNumber, pageSize },
      auth,
    });
    return { items, pageNumber, pageSize, hasNextPage: items.length === pageSize };
  }

  /**
   * Bulk fetch by id. POSTs `/products/search` with `q="id:(id1,id2,…)"`,
   * chunking when the list is larger than `options.chunkSize` (default
   * 100). An empty list short-circuits with no HTTP call. **Order is not
   * guaranteed** across chunks — re-index by `id` if order matters.
   */
  async searchByIds(
    ids: string[],
    options: { chunkSize?: number } = {},
    auth: AuthContext = ANON,
  ): Promise<Product[]> {
    if (ids.length === 0) return [];
    const chunkSize = options.chunkSize ?? 100;
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += chunkSize) {
      chunks.push(ids.slice(i, i + chunkSize));
    }
    const pages = await Promise.all(
      chunks.map((chunk) =>
        this.ctx.http.request<Product[]>({
          method: "POST",
          path: `/product/${this.ctx.tenant}/products/search`,
          query: { pageSize: chunk.length },
          auth,
          body: { q: `id:(${chunk.join(",")})` },
        }),
      ),
    );
    return pages.flat();
  }

  /**
   * Streams the VARIANT children of a PARENT_VARIANT product, page by page,
   * via the search query `productType:VARIANT parentVariantId:<id>`. Default
   * pageSize 200. The query syntax (space-separated fields = implicit AND) is
   * encapsulated here so consumers don't build it themselves.
   */
  listVariantChildrenAll(
    parentVariantId: string,
    params: { pageSize?: number } = {},
    auth: AuthContext = ANON,
  ): AsyncIterable<Product> {
    const pageSize = params.pageSize ?? 200;
    const q = `productType:VARIANT parentVariantId:${parentVariantId}`;
    return iterateAll<Product>((pageNumber) => this.search(q, { pageNumber, pageSize }, auth));
  }

  /**
   * Resolves ALL VARIANT children of a PARENT_VARIANT product into a flat
   * array (loads every page). Default pageSize 200. Returns `[]` when there are
   * no children — never throws.
   */
  async listVariantChildren(
    parentVariantId: string,
    params: { pageSize?: number } = {},
    auth: AuthContext = ANON,
  ): Promise<Product[]> {
    const out: Product[] = [];
    for await (const child of this.listVariantChildrenAll(parentVariantId, params, auth)) {
      out.push(child);
    }
    return out;
  }
}
