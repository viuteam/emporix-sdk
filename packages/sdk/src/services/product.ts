import type { ClientContext, PaginatedItems } from "../core/context";
import { iterateAll } from "../core/context";
import type { AuthContext } from "../core/auth";
import { resolveQuery, type QueryFor } from "../core/query";
import type {
  BasicProductWithId,
  BundleProductWithId,
  ParentVariantProductWithId,
  ProductMedia,
  ProductCreateBody,
  ProductUpdateBody,
  ProductPartialUpdateBody,
  ProductBulkCreateBody,
  ProductBulkUpdateBody,
  BulkResponse,
  ResourceLocation,
  DynamicVariantRecalculationRequest,
  DynamicVariantRecalculationResponse,
  DynamicVariantRecalculationJobResponse,
  DynamicVariantRecalculationJobStatus,
  ProductTemplateResponse,
  ProductTemplateCreation,
  ProductTemplateUpdate,
} from "../generated/product";

const ANON: AuthContext = { kind: "anonymous" };
const SERVICE: AuthContext = { kind: "service" };

/** A product as returned by the Product service (all generated fields). */
export type Product = BasicProductWithId | BundleProductWithId | ParentVariantProductWithId;

/** A single product media entry (generated; `ProductMedia` is the list type). */
export type Media = ProductMedia[number];

/** Body for creating a product (`POST /products`) — any of the 5 product shapes. */
export type ProductCreateInput = ProductCreateBody;

/** Body for a full product replace (`PUT /products/{id}`). */
export type ProductUpdateInput = ProductUpdateBody;

/** Body for a partial product update (`PATCH /products/{id}`). */
export type ProductPatchInput = ProductPartialUpdateBody;

/** Id/location envelope returned when a product is created. */
export type ProductCreated = ResourceLocation;

/** Body for bulk-creating products (`POST /products/bulk`). */
export type ProductBulkCreateInput = ProductBulkCreateBody;

/** Body for bulk-updating products (`PUT /products/bulk`). */
export type ProductBulkUpdateInput = ProductBulkUpdateBody;

/** Per-entry result of a bulk product operation (207 Multi-Status). */
export type ProductBulkResult = BulkResponse;

/** Body for triggering a dynamic-variant recalculation. */
export type ProductRecalculationInput = DynamicVariantRecalculationRequest;

/** Result of triggering a recalculation — created jobs plus skipped product ids. */
export type ProductRecalculationResult = DynamicVariantRecalculationResponse;

/** A dynamic-variant recalculation job. */
export type ProductRecalculationJob = DynamicVariantRecalculationJobResponse;

/** Status of a recalculation job. */
export type ProductRecalculationJobStatus = DynamicVariantRecalculationJobStatus;

/** A product template as returned by the Product service. */
export type ProductTemplate = ProductTemplateResponse;

/** Body for creating a product template. */
export type ProductTemplateCreateInput = ProductTemplateCreation;

/** Body for updating a product template (`PUT`, full replace). */
export type ProductTemplateUpdateInput = ProductTemplateUpdate;

/** Id envelope returned when a product template is created. */
export type ProductTemplateCreated = { id?: string };

/** Query flags shared by the product write endpoints. */
export interface ProductWriteOptions {
  skipVariantGeneration?: boolean;
  doIndex?: boolean;
  skipRelatedItemsValidation?: boolean;
}

/** Catalog reads. Default auth: anonymous; pass customer for personalized pricing. */
export class ProductService {
  static readonly channel = "product" as const;
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

  /**
   * Searches products by a `q` filter — a raw Emporix DSL string or a built
   * filter (e.g. `@viu/emporix-mixins`' `mixinQuery(...)`). Product supports
   * `compoundLogicalQuery`, so `or()` filters are allowed.
   */
  async search(
    query: QueryFor<"PRODUCT">,
    params: { pageNumber?: number; pageSize?: number } = {},
    auth: AuthContext = ANON,
  ): Promise<PaginatedItems<Product>> {
    const q = resolveQuery(query, { compoundLogicalQuery: true });
    const pageNumber = params.pageNumber ?? 1;
    const pageSize = params.pageSize ?? 50;
    const items = await this.ctx.http.request<Product[]>({
      method: "GET",
      path: `/product/${this.ctx.tenant}/products`,
      query: { q, pageNumber, pageSize },
      auth,
    });
    return { items, pageNumber, pageSize, hasNextPage: items.length === pageSize };
  }

  /**
   * Free-text product search by name. The product `q` is a `field:value` DSL,
   * so a bare term (e.g. "in time") 400s with "No value for key …". This builds
   * a `name:(~<term>)` regex filter (regex metacharacters escaped) and delegates
   * to {@link search}.
   */
  async searchByName(
    query: string,
    params: { pageNumber?: number; pageSize?: number } = {},
    auth: AuthContext = ANON,
  ): Promise<PaginatedItems<Product>> {
    const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return this.search(`name:(~${escaped})`, params, auth);
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
          idempotent: true, // pure read over POST — safe to replay on 5xx/429
        }),
      ),
    );
    return pages.flat();
  }

  /**
   * Bulk fetch by code. POSTs `/products/search` with `q="code:(c1,c2,…)"`,
   * chunking when the list is larger than `options.chunkSize` (default 100).
   * Duplicate codes are de-duplicated. Codes containing query-delimiter
   * characters (`(`, `)`, `,`, whitespace, `"`) are dropped with a logged
   * warning, because the Emporix `q` syntax uses them as delimiters and does
   * not support escaping them in a plain IN-list. An empty list — or one with
   * no safe codes — short-circuits with no HTTP call. **Order is not
   * guaranteed** across chunks — re-index by `code` if order matters.
   */
  async searchByCodes(
    codes: string[],
    options: { chunkSize?: number } = {},
    auth: AuthContext = ANON,
  ): Promise<Product[]> {
    const unique = [...new Set(codes)];
    const unsafe = /[(),"\s]/;
    const safe = unique.filter((c) => !unsafe.test(c));
    const dropped = unique.filter((c) => unsafe.test(c));
    if (dropped.length > 0) {
      this.ctx.logger.warn(
        "products.searchByCodes: dropped codes containing query-delimiter characters",
        { dropped },
      );
    }
    if (safe.length === 0) return [];
    const chunkSize = options.chunkSize ?? 100;
    const chunks: string[][] = [];
    for (let i = 0; i < safe.length; i += chunkSize) {
      chunks.push(safe.slice(i, i + chunkSize));
    }
    const pages = await Promise.all(
      chunks.map((chunk) =>
        this.ctx.http.request<Product[]>({
          method: "POST",
          path: `/product/${this.ctx.tenant}/products/search`,
          query: { pageSize: chunk.length },
          auth,
          body: { q: `code:(${chunk.join(",")})` },
          idempotent: true, // pure read over POST — safe to replay on 5xx/429
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

  // --- Admin writes. Default auth: service. ---

  /**
   * Creates a product (`POST /products`). Default auth: service. Accepts any of
   * the five product shapes (basic, bundle, parent-variant, variant,
   * dynamic-variant).
   */
  async create(
    input: ProductCreateInput,
    options: ProductWriteOptions = {},
    auth: AuthContext = SERVICE,
  ): Promise<ProductCreated> {
    const query = {
      ...(options.skipVariantGeneration === undefined ? {} : { skipVariantGeneration: String(options.skipVariantGeneration) }),
      ...(options.doIndex === undefined ? {} : { doIndex: String(options.doIndex) }),
      ...(options.skipRelatedItemsValidation === undefined ? {} : { skipRelatedItemsValidation: String(options.skipRelatedItemsValidation) }),
    };
    return this.ctx.http.request<ProductCreated>({
      method: "POST",
      path: `/product/${this.ctx.tenant}/products`,
      ...(Object.keys(query).length > 0 ? { query } : {}),
      body: input,
      auth,
    });
  }

  /**
   * Partially updates a product (`PATCH /products/{productId}`). Default auth:
   * service. Use {@link replace} for a full replace (PUT).
   */
  async update(
    productId: string,
    input: ProductPatchInput,
    options: ProductWriteOptions = {},
    auth: AuthContext = SERVICE,
  ): Promise<void> {
    const query = {
      ...(options.skipVariantGeneration === undefined ? {} : { skipVariantGeneration: String(options.skipVariantGeneration) }),
      ...(options.doIndex === undefined ? {} : { doIndex: String(options.doIndex) }),
      ...(options.skipRelatedItemsValidation === undefined ? {} : { skipRelatedItemsValidation: String(options.skipRelatedItemsValidation) }),
    };
    await this.ctx.http.request<void>({
      method: "PATCH",
      path: `/product/${this.ctx.tenant}/products/${productId}`,
      ...(Object.keys(query).length > 0 ? { query } : {}),
      body: input,
      auth,
    });
  }

  /**
   * Full-replaces a product (`PUT /products/{productId}`). Returns the created
   * resource on 201 (upsert) and nothing on 204. `options.partial` sends
   * `?partial=true` for a merge-style replace. Default auth: service.
   */
  async replace(
    productId: string,
    input: ProductUpdateInput,
    options: ProductWriteOptions & { partial?: boolean } = {},
    auth: AuthContext = SERVICE,
  ): Promise<ProductCreated | void> {
    const query = {
      ...(options.partial === undefined ? {} : { partial: String(options.partial) }),
      ...(options.skipVariantGeneration === undefined ? {} : { skipVariantGeneration: String(options.skipVariantGeneration) }),
      ...(options.doIndex === undefined ? {} : { doIndex: String(options.doIndex) }),
      ...(options.skipRelatedItemsValidation === undefined ? {} : { skipRelatedItemsValidation: String(options.skipRelatedItemsValidation) }),
    };
    return this.ctx.http.request<ProductCreated | void>({
      method: "PUT",
      path: `/product/${this.ctx.tenant}/products/${productId}`,
      ...(Object.keys(query).length > 0 ? { query } : {}),
      body: input,
      auth,
    });
  }

  /**
   * Deletes a product (`DELETE /products/{productId}`). `options.force` deletes
   * even when the product is referenced. Default auth: service.
   */
  async delete(
    productId: string,
    options: { force?: boolean; doIndex?: boolean } = {},
    auth: AuthContext = SERVICE,
  ): Promise<void> {
    const query = {
      ...(options.force === undefined ? {} : { force: String(options.force) }),
      ...(options.doIndex === undefined ? {} : { doIndex: String(options.doIndex) }),
    };
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `/product/${this.ctx.tenant}/products/${productId}`,
      ...(Object.keys(query).length > 0 ? { query } : {}),
      auth,
    });
  }
}
